-- Printing truthfulness boundary for Premier Print Agent.
-- Electron/Windows can confirm that the print call was accepted, but that is
-- not proof that paper physically exited the printer. Keep print-once and
-- controlled-reprint semantics by recording the submitted execution attempt,
-- while never labelling that operating-system acknowledgement as physical
-- print success.

ALTER TABLE public.cloud_print_jobs
  DROP CONSTRAINT IF EXISTS cloud_print_jobs_status_check;

ALTER TABLE public.cloud_print_jobs
  ADD CONSTRAINT cloud_print_jobs_status_check
  CHECK (status IN ('pending', 'claimed', 'printing', 'submitted', 'printed', 'failed'));

ALTER TABLE public.cloud_print_jobs
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NULL;

COMMENT ON COLUMN public.cloud_print_jobs.submitted_at IS
'Time Windows/Electron accepted the print call. This is not proof of physical paper output.';

COMMENT ON TABLE public.sale_print_events IS
'Records accepted receipt print execution attempts for print-once/reprint control. An event is not proof of physical paper output unless a separate physical confirmation source exists.';

CREATE OR REPLACE FUNCTION public.record_sale_print(
  p_sale_id uuid,
  p_approval_request_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_count integer;
  v_req public.approval_requests%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE id = auth.uid() AND is_active = true;
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_sale.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT count(*)::int INTO v_count
  FROM public.sale_print_events
  WHERE sale_id = p_sale_id;

  IF v_count = 0 THEN
    IF NOT public.can_permission('pos.receipt.print') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PERMISSION_DENIED',
        'permission', 'pos.receipt.print'
      );
    END IF;
  ELSIF NOT public.can_permission('pos.reprint') THEN
    IF p_approval_request_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MANAGER_APPROVAL_REQUIRED',
        'action', 'reprint'
      );
    END IF;

    SELECT * INTO v_req
    FROM public.approval_requests
    WHERE id = p_approval_request_id
    FOR UPDATE;

    IF v_req.id IS NULL
      OR v_req.requester_id <> auth.uid()
      OR v_req.branch_id <> v_sale.branch_id
      OR v_req.action_type <> 'reprint'
      OR v_req.entity_type <> 'sale'
      OR v_req.entity_id IS DISTINCT FROM p_sale_id
      OR v_req.status <> 'approved'
      OR v_req.expires_at <= now()
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
    END IF;

    UPDATE public.approval_requests
    SET status = 'consumed', consumed_at = now()
    WHERE id = v_req.id;
  END IF;

  INSERT INTO public.sale_print_events(
    sale_id, branch_id, user_id, print_number, approval_request_id
  )
  VALUES(
    p_sale_id,
    v_sale.branch_id,
    auth.uid(),
    v_count + 1,
    CASE WHEN v_count > 0 THEN p_approval_request_id ELSE NULL END
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_log(
    user_id, user_email, action, entity, entity_id, details, branch_id
  )
  VALUES(
    auth.uid(),
    v_user.email,
    CASE WHEN v_count = 0 THEN 'SALE_PRINT_SUBMITTED' ELSE 'SALE_REPRINT_SUBMITTED' END,
    'sale',
    p_sale_id,
    jsonb_build_object(
      'print_number', v_count + 1,
      'approval_request_id', p_approval_request_id,
      'print_call_accepted_by_client', true,
      'physical_print_confirmed', false
    ),
    v_sale.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'print_number', v_count + 1,
    'is_reprint', (v_count > 0),
    'physical_print_confirmed', false
  );
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
      'error', CASE WHEN v_ambiguous THEN 'PRINT_OUTCOME_UNKNOWN' ELSE v_error END,
      'physical_print_confirmed', false
    );
  END IF;

  -- p_success means the Windows/Electron print call returned success. It is an
  -- accepted submission, not generic proof that paper physically printed.
  IF v_job.kind = 'receipt' THEN
    SELECT * INTO v_sale FROM public.sales WHERE id = v_job.sale_id FOR UPDATE;
    IF v_sale.id IS NULL OR v_sale.branch_id <> v_job.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND');
    END IF;

    SELECT count(*)::integer INTO v_print_count
    FROM public.sale_print_events
    WHERE sale_id = v_job.sale_id;

    IF v_job.expected_print_number IS DISTINCT FROM (v_print_count + 1) THEN
      UPDATE public.cloud_print_jobs
      SET status = 'failed',
          attempts = GREATEST(attempts, 5),
          last_error = 'PRINT_SEQUENCE_CHANGED',
          updated_at = now()
      WHERE id = v_job.id;
      RETURN jsonb_build_object('success', false, 'error', 'PRINT_SEQUENCE_CHANGED');
    END IF;

    IF v_print_count > 0 THEN
      SELECT * INTO v_req
      FROM public.approval_requests
      WHERE id = v_job.approval_request_id
      FOR UPDATE;

      IF v_req.id IS NULL
        OR v_req.requester_id <> v_job.requested_by
        OR v_req.branch_id <> v_job.branch_id
        OR v_req.action_type <> 'reprint'
        OR v_req.entity_type <> 'sale'
        OR v_req.entity_id IS DISTINCT FROM v_job.sale_id
        OR v_req.status <> 'approved'
        OR v_req.expires_at <= now()
      THEN
        UPDATE public.cloud_print_jobs
        SET status = 'failed',
            attempts = GREATEST(attempts, 5),
            last_error = 'INVALID_APPROVAL',
            updated_at = now()
        WHERE id = v_job.id;
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_APPROVAL');
      END IF;

      UPDATE public.approval_requests
      SET status = 'consumed', consumed_at = now()
      WHERE id = v_req.id;
    END IF;

    INSERT INTO public.sale_print_events(sale_id, branch_id, user_id, print_number, approval_request_id)
    VALUES (
      v_job.sale_id,
      v_job.branch_id,
      v_job.requested_by,
      v_print_count + 1,
      CASE WHEN v_print_count > 0 THEN v_job.approval_request_id ELSE NULL END
    )
    RETURNING id INTO v_event_id;

    SELECT * INTO v_requester FROM public.users WHERE id = v_job.requested_by;
    INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
    VALUES (
      v_job.requested_by,
      v_requester.email,
      CASE WHEN v_print_count = 0 THEN 'SALE_PRINT_SUBMITTED' ELSE 'SALE_REPRINT_SUBMITTED' END,
      'sale',
      v_job.sale_id,
      jsonb_build_object(
        'print_number', v_print_count + 1,
        'approval_request_id', v_job.approval_request_id,
        'print_call_accepted_by_cloud_agent', true,
        'physical_print_confirmed', false,
        'cloud_print_job_id', v_job.id
      ),
      v_job.branch_id
    );
  END IF;

  UPDATE public.cloud_print_jobs
  SET status = 'submitted',
      submitted_at = now(),
      printed_at = NULL,
      last_error = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'submitted',
    'event_id', v_event_id,
    'physical_print_confirmed', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.record_sale_print(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale_print(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
