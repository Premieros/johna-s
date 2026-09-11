-- Do not automatically repeat a job when Windows may already have accepted it.
-- Claimed-but-not-started work is safe to retry. A printing lease expiry or
-- PRINT_CALLBACK_TIMEOUT is ambiguous and is therefore terminal until a human
-- explicitly decides to print again.

CREATE OR REPLACE FUNCTION public.claim_cloud_print_jobs(
  p_branch_id uuid,
  p_agent_id uuid,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_jobs jsonb := '[]'::jsonb;
  v_limit integer := LEAST(25, GREATEST(1, COALESCE(p_limit, 12)));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_agent_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AGENT_ID_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  -- The agent had not started the physical print yet. This lease can safely be
  -- released for a bounded retry.
  UPDATE public.cloud_print_jobs
  SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
      claimed_agent_id = NULL,
      claimed_by_user = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      next_attempt_at = CASE WHEN attempts >= 5 THEN next_attempt_at ELSE now() END,
      last_error = COALESCE(last_error, 'CLAIM_LEASE_EXPIRED'),
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND status = 'claimed'
    AND lease_expires_at < now();

  -- Once the job entered printing, a dead agent cannot prove whether Windows
  -- already accepted the job. Never auto-repeat that ambiguous outcome.
  UPDATE public.cloud_print_jobs
  SET status = 'failed',
      attempts = GREATEST(attempts, 5),
      claimed_agent_id = NULL,
      claimed_by_user = NULL,
      claimed_at = NULL,
      lease_expires_at = NULL,
      last_error = 'PRINT_OUTCOME_UNKNOWN',
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND status = 'printing'
    AND lease_expires_at < now();

  WITH picked AS (
    SELECT id
    FROM public.cloud_print_jobs
    WHERE branch_id = p_branch_id
      AND status IN ('pending', 'failed')
      AND attempts < 5
      AND next_attempt_at <= now()
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.cloud_print_jobs j
    SET status = 'claimed',
        claimed_agent_id = p_agent_id,
        claimed_by_user = auth.uid(),
        claimed_at = now(),
        lease_expires_at = now() + interval '45 seconds',
        attempts = j.attempts + 1,
        last_error = NULL,
        updated_at = now()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.id, j.branch_id, j.kind, j.station_code, j.payload,
              j.sale_id, j.expected_print_number, j.attempts, j.created_at
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(claimed) ORDER BY created_at, id), '[]'::jsonb)
    INTO v_jobs
  FROM claimed;

  RETURN jsonb_build_object('success', true, 'jobs', v_jobs);
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_cloud_print_job(
  p_job_id uuid,
  p_agent_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_job public.cloud_print_jobs%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_requester public.users%ROWTYPE;
  v_req public.approval_requests%ROWTYPE;
  v_print_count integer;
  v_event_id uuid;
  v_error text := left(COALESCE(NULLIF(btrim(p_error), ''), 'PRINT_FAILED'), 1000);
  v_ambiguous boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT public.can_permission('settings.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'settings.manage');
  END IF;

  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_job.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;
  IF v_job.claimed_agent_id IS DISTINCT FROM p_agent_id OR v_job.status NOT IN ('claimed', 'printing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLAIM_MISMATCH');
  END IF;

  IF NOT COALESCE(p_success, false) THEN
    v_ambiguous := upper(v_error) IN ('PRINT_CALLBACK_TIMEOUT', 'PRINT_OUTCOME_UNKNOWN');
    UPDATE public.cloud_print_jobs
    SET status = 'failed',
        attempts = CASE WHEN v_ambiguous THEN GREATEST(attempts, 5) ELSE attempts END,
        last_error = CASE WHEN v_ambiguous THEN 'PRINT_OUTCOME_UNKNOWN' ELSE v_error END,
        next_attempt_at = CASE
          WHEN v_ambiguous THEN next_attempt_at
          ELSE now() + make_interval(secs => LEAST(30, GREATEST(2, attempts * 2)))
        END,
        claimed_agent_id = NULL,
        claimed_by_user = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'failed',
      'retryable', NOT v_ambiguous AND v_job.attempts < 5,
      'error', CASE WHEN v_ambiguous THEN 'PRINT_OUTCOME_UNKNOWN' ELSE v_error END
    );
  END IF;

  IF v_job.kind = 'receipt' THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_job.sale_id FOR UPDATE;
    IF v_sale.id IS NULL OR v_sale.branch_id <> v_job.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;
    SELECT count(*)::integer INTO v_print_count FROM public.sale_print_events WHERE sale_id = v_job.sale_id;
    IF v_job.expected_print_number IS DISTINCT FROM (v_print_count + 1) THEN
      UPDATE public.cloud_print_jobs SET status = 'failed', attempts = GREATEST(attempts, 5), last_error = 'PRINT_SEQUENCE_CHANGED', updated_at = now() WHERE id = v_job.id;
      RETURN jsonb_build_object('success', false, 'error', 'PRINT_SEQUENCE_CHANGED');
    END IF;

    IF v_print_count > 0 THEN
      SELECT * INTO v_req FROM public.approval_requests WHERE id = v_job.approval_request_id FOR UPDATE;
      IF v_req.id IS NULL
        OR v_req.requester_id <> v_job.requested_by
        OR v_req.branch_id <> v_job.branch_id
        OR v_req.action_type <> 'reprint'
        OR v_req.entity_type <> 'sale'
        OR v_req.entity_id IS DISTINCT FROM v_job.sale_id
        OR v_req.status <> 'approved'
        OR v_req.expires_at <= now()
      THEN
        UPDATE public.cloud_print_jobs SET status = 'failed', attempts = GREATEST(attempts, 5), last_error = 'INVALID_APPROVAL', updated_at = now() WHERE id = v_job.id;
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
      END IF;
      UPDATE public.approval_requests SET status = 'consumed', consumed_at = now() WHERE id = v_req.id;
    END IF;

    INSERT INTO public.sale_print_events(sale_id, branch_id, user_id, print_number, approval_request_id)
    VALUES (v_job.sale_id, v_job.branch_id, v_job.requested_by, v_print_count + 1,
      CASE WHEN v_print_count > 0 THEN v_job.approval_request_id ELSE NULL END)
    RETURNING id INTO v_event_id;

    SELECT * INTO v_requester FROM public.users WHERE id = v_job.requested_by;
    INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
    VALUES (
      v_job.requested_by,
      v_requester.email,
      CASE WHEN v_print_count = 0 THEN 'SALE_PRINTED' ELSE 'SALE_REPRINTED' END,
      'sale',
      v_job.sale_id,
      jsonb_build_object(
        'print_number', v_print_count + 1,
        'approval_request_id', v_job.approval_request_id,
        'execution_confirmed_by_cloud_agent', true,
        'cloud_print_job_id', v_job.id
      ),
      v_job.branch_id
    );
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'printed',
      printed_at = now(),
      last_error = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object('success', true, 'status', 'printed', 'event_id', v_event_id);
END
$function$;

REVOKE ALL ON FUNCTION public.claim_cloud_print_jobs(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_cloud_print_jobs(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
