-- Only new Smouha Z jobs; existing agents and all other branches unchanged.
CREATE OR REPLACE FUNCTION public.enqueue_cloud_report_print(p_branch_id uuid, p_payload jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_job public.cloud_print_jobs%ROWTYPE; v_first public.cloud_print_jobs%ROWTYPE;
 v_payload jsonb; v_parts text[]; v_i integer; v_key text; v_ids jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF;
 IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF;
 IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift'); END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD'); END IF;
 IF COALESCE(btrim(p_idempotency_key),'')='' THEN RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED'); END IF;
 v_key:=btrim(p_idempotency_key);
 -- Serialize duplicate report submissions before checking the root job. A report
 -- accepted before this migration is returned unchanged, never expanded/replayed.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_branch_id::text||':report:'||v_key,0));
 SELECT * INTO v_first FROM public.cloud_print_jobs WHERE branch_id=p_branch_id AND idempotency_key=v_key;
 IF v_first.id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'job_id',v_first.id,'status',v_first.status,'station_code',v_first.station_code,'deduplicated',true); END IF;
 v_payload:=public._normalize_thermal_print_payload(p_payload);
 -- All branches use Cleopatra's existing single-job report path.
 v_parts:=ARRAY[v_payload->>'text'];
 FOR v_i IN 1..cardinality(v_parts) LOOP
  INSERT INTO public.cloud_print_jobs(branch_id,requested_by,kind,station_code,payload,idempotency_key,created_at)
  VALUES(p_branch_id,auth.uid(),CASE WHEN p_branch_id = '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid THEN 'receipt' ELSE 'report' END,'cashier',
   CASE WHEN cardinality(v_parts)>1 THEN
    (v_payload-'template')||jsonb_build_object('text','Z ['||v_i||'/'||cardinality(v_parts)||']'||E'\n'||v_parts[v_i],
      'report_page',v_i,'report_pages',cardinality(v_parts)) ELSE v_payload END,
   CASE WHEN v_i=1 THEN v_key ELSE v_key||':page:'||v_i END,
   transaction_timestamp()+(v_i-1)*interval '1 microsecond') RETURNING * INTO v_job;
  IF v_i=1 THEN v_first:=v_job; END IF;
  v_ids:=v_ids||jsonb_build_array(v_job.id);
 END LOOP;
 RETURN jsonb_build_object('success',true,'job_id',v_first.id,'status',v_first.status,'station_code','cashier','job_ids',v_ids,'pages',cardinality(v_parts));
END $function$
;