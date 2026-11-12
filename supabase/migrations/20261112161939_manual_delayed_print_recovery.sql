-- Additive manager fallback. Frozen installed-agent functions remain unchanged.
CREATE OR REPLACE FUNCTION public.list_delayed_cloud_print_jobs(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE jobs jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('pos.print_recovery') THEN
  RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
 END IF;
 IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
  RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.created_at),'[]'::jsonb) INTO jobs FROM (
  SELECT id,kind,station_code,created_at,
   (SELECT string_agg(left(m->>'label',24)||': '||left(m->>'value',80),' · ')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload#>'{template,meta}')='array'
     THEN payload#>'{template,meta}' ELSE '[]'::jsonb END) m
    WHERE m->>'label' IN ('Order','رقم الطلب','Table','الطاولة','Invoice','رقم الفاتورة')) context
  FROM public.cloud_print_jobs
  WHERE branch_id=p_branch_id AND status='pending' AND attempts=0
   AND created_at BETWEEN now()-interval '24 hours' AND now()-interval '15 seconds'
   AND public.can_execute_cloud_print_kind(kind)
  ORDER BY created_at LIMIT 50
 ) j;
 RETURN jsonb_build_object('success',true,'jobs',jobs);
END $$;

CREATE OR REPLACE FUNCTION public.reserve_manual_cloud_print_job(p_job_id uuid,p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.cloud_print_jobs%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('pos.print_recovery') THEN
  RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
 END IF;
 IF p_agent_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','AGENT_ID_REQUIRED'); END IF;
 SELECT * INTO j FROM public.cloud_print_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL THEN RETURN jsonb_build_object('success',false,'error','JOB_NOT_FOUND'); END IF;
 IF NOT public.user_may_access_branch(j.branch_id) OR NOT public.can_execute_cloud_print_kind(j.kind) THEN
  RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
 END IF;
 IF j.status<>'pending' OR j.attempts<>0 OR j.created_at>now()-interval '15 seconds' OR j.created_at<now()-interval '24 hours' THEN
  RETURN jsonb_build_object('success',false,'error','JOB_NO_LONGER_PENDING');
 END IF;
 UPDATE public.cloud_print_jobs SET status='claimed',claimed_agent_id=p_agent_id,claimed_by_user=auth.uid(),
  claimed_at=now(),lease_expires_at=now()+interval '45 seconds',attempts=attempts+1,updated_at=now() WHERE id=j.id;
 -- Retain canonical sale/approval/sequence validation before any browser output.
 result:=public.start_cloud_print_job(j.id,p_agent_id);
 IF NOT coalesce((result->>'success')::boolean,false) THEN RETURN result; END IF;
 UPDATE public.cloud_print_jobs SET lease_expires_at=now()+interval '10 minutes' WHERE id=j.id;
 INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
 VALUES(auth.uid(),'MANUAL_PRINT_RESERVED','cloud_print_job',j.id,jsonb_build_object('agent_id',p_agent_id,'station',j.station_code),j.branch_id);
 RETURN jsonb_build_object('success',true,'job',jsonb_build_object('id',j.id,'kind',j.kind,'station_code',j.station_code,'payload',j.payload));
END $$;

CREATE OR REPLACE FUNCTION public.finish_manual_cloud_print_job(p_job_id uuid,p_agent_id uuid,p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.cloud_print_jobs%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('pos.print_recovery') THEN
  RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
 END IF;
 SELECT * INTO j FROM public.cloud_print_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.claimed_by_user IS DISTINCT FROM auth.uid() OR j.claimed_agent_id IS DISTINCT FROM p_agent_id
  OR j.status<>'printing' OR NOT public.user_may_access_branch(j.branch_id) THEN
  RETURN jsonb_build_object('success',false,'error','CLAIM_MISMATCH');
 END IF;
 result:=public.complete_cloud_print_job(j.id,p_agent_id,coalesce(p_confirmed,false),'PRINT_OUTCOME_UNKNOWN');
 IF coalesce((result->>'success')::boolean,false) THEN
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
  VALUES(auth.uid(),'MANUAL_PRINT_CONFIRMED','cloud_print_job',j.id,jsonb_build_object('confirmed',coalesce(p_confirmed,false)),j.branch_id);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_delayed_cloud_print_jobs(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reserve_manual_cloud_print_job(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finish_manual_cloud_print_job(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_delayed_cloud_print_jobs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_manual_cloud_print_job(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_manual_cloud_print_job(uuid,uuid,boolean) TO authenticated;
