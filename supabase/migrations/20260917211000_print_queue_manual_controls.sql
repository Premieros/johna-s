-- Manual print-queue controls for settings managers.
-- Safe retry is allowed only for failures that are known not to represent an
-- ambiguous/accepted Windows print outcome. Pending/failed jobs may be cancelled
-- before an agent starts printing them. All actions are audited.

ALTER TABLE public.cloud_print_jobs
  DROP CONSTRAINT IF EXISTS cloud_print_jobs_status_check;

ALTER TABLE public.cloud_print_jobs
  ADD CONSTRAINT cloud_print_jobs_status_check
  CHECK (status IN ('pending', 'claimed', 'printing', 'submitted', 'printed', 'failed', 'cancelled'));

ALTER TABLE public.cloud_print_jobs
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.retry_cloud_print_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_error text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  SELECT * INTO v_job
  FROM public.cloud_print_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_job.status <> 'failed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_RETRYABLE', 'status', v_job.status);
  END IF;

  v_error := upper(COALESCE(v_job.last_error, ''));
  IF v_error IN ('PRINT_OUTCOME_UNKNOWN', 'PRINT_CALLBACK_TIMEOUT', 'PRINT_SEQUENCE_CHANGED', 'INVALID_APPROVAL') THEN
    RETURN jsonb_build_object('success', false, 'error', 'MANUAL_RETRY_BLOCKED', 'last_error', v_job.last_error);
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'pending',
      attempts = 0,
      next_attempt_at = now(),
      last_error = NULL,
      claimed_agent_id = NULL,
      claimed_by_user = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      cancelled_at = NULL,
      cancelled_by = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  SELECT * INTO v_user FROM public.users WHERE id = auth.uid();
  INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    v_user.email,
    'PRINT_JOB_MANUAL_RETRY',
    'cloud_print_job',
    v_job.id,
    jsonb_build_object(
      'station_code', v_job.station_code,
      'kind', v_job.kind,
      'previous_status', v_job.status,
      'previous_error', v_job.last_error,
      'previous_attempts', v_job.attempts
    ),
    v_job.branch_id
  );

  RETURN jsonb_build_object('success', true, 'status', 'pending');
END
$function$;

CREATE OR REPLACE FUNCTION public.cancel_cloud_print_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_user public.users%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  SELECT * INTO v_job
  FROM public.cloud_print_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_job.status NOT IN ('pending', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_CANCELLABLE', 'status', v_job.status);
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      claimed_agent_id = NULL,
      claimed_by_user = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  SELECT * INTO v_user FROM public.users WHERE id = auth.uid();
  INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    v_user.email,
    'PRINT_JOB_CANCELLED',
    'cloud_print_job',
    v_job.id,
    jsonb_build_object(
      'station_code', v_job.station_code,
      'kind', v_job.kind,
      'previous_status', v_job.status,
      'previous_error', v_job.last_error,
      'attempts', v_job.attempts
    ),
    v_job.branch_id
  );

  RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END
$function$;

REVOKE ALL ON FUNCTION public.retry_cloud_print_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_cloud_print_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_cloud_print_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_cloud_print_job(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
