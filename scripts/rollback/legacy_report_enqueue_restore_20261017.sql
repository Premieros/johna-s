-- Restore only future report enqueue. Never delete or requeue accepted pages.
BEGIN;
CREATE OR REPLACE FUNCTION public.enqueue_cloud_report_print(
  p_branch_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD');
  END IF;
  IF COALESCE(btrim(p_idempotency_key),'')='' THEN
    RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id,requested_by,kind,station_code,payload,idempotency_key
  ) VALUES (
    p_branch_id,auth.uid(),'report','cashier',p_payload,btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id,idempotency_key) DO UPDATE
  SET updated_at=public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'success',true,'job_id',v_job.id,'status',v_job.status,'station_code','cashier'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_report_print(uuid,jsonb,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
