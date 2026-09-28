-- Operator friction fixes:
-- 1) 60-second work-authorization request lifetime with explicit expiry.
-- 2) Preserve direct receipt reprint for the original requester when they own pos.reprint.
-- No Print Agent protocol/routing/KDS changes.

ALTER TABLE public.work_authorizations
  DROP CONSTRAINT IF EXISTS work_authorizations_status_check;
ALTER TABLE public.work_authorizations
  ADD CONSTRAINT work_authorizations_status_check
  CHECK (status IN ('pending','approved','rejected','revoked','expired'));

ALTER TABLE public.work_authorization_events
  DROP CONSTRAINT IF EXISTS work_authorization_events_type_check;
ALTER TABLE public.work_authorization_events
  ADD CONSTRAINT work_authorization_events_type_check
  CHECK (event_type IN ('requested','approved','rejected','revoked','expired'));

CREATE OR REPLACE FUNCTION public.get_my_work_authorization_state(
  p_branch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_branch_name text;
  v_required boolean;
  v_can_work boolean;
  v_row public.work_authorizations%ROWTYPE;
  v_effective_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  SELECT b.name INTO v_branch_name FROM public.branches b WHERE b.id = p_branch_id;
  IF v_branch_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  v_required := public.requires_work_authorization(v_user_id, p_branch_id);
  v_can_work := public.can_user_work(p_branch_id);

  IF NOT v_required THEN
    RETURN jsonb_build_object(
      'branchId', p_branch_id,
      'branchName', v_branch_name,
      'requiresAuthorization', false,
      'canWork', true,
      'status', 'not_required'
    );
  END IF;

  SELECT wa.*
  INTO v_row
  FROM public.work_authorizations wa
  WHERE wa.user_id = v_user_id
    AND wa.branch_id = p_branch_id
  ORDER BY
    CASE
      WHEN wa.status = 'approved' THEN 0
      WHEN wa.status = 'pending' AND wa.requested_at > now() - interval '1 minute' THEN 1
      ELSE 2
    END,
    GREATEST(
      wa.updated_at,
      wa.requested_at,
      COALESCE(wa.decided_at, '-infinity'::timestamptz),
      COALESCE(wa.revoked_at, '-infinity'::timestamptz)
    ) DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'branchId', p_branch_id,
      'branchName', v_branch_name,
      'requiresAuthorization', true,
      'canWork', false,
      'status', 'not_requested'
    );
  END IF;

  v_effective_status := CASE
    WHEN v_row.status = 'pending'
      AND v_row.requested_at <= now() - interval '1 minute'
      THEN 'expired'
    ELSE v_row.status
  END;

  RETURN jsonb_build_object(
    'branchId', p_branch_id,
    'branchName', v_branch_name,
    'requiresAuthorization', true,
    'canWork', v_can_work,
    'status', v_effective_status,
    'requestId', CASE WHEN v_effective_status = 'pending' THEN v_row.id ELSE NULL END,
    'authorizationId', CASE WHEN v_effective_status = 'approved' THEN v_row.id ELSE NULL END,
    'requestedAt', v_row.requested_at,
    'decidedAt', v_row.decided_at,
    'decisionReason', CASE
      WHEN v_effective_status = 'expired' THEN 'REQUEST_EXPIRED'
      ELSE COALESCE(v_row.decision_reason, v_row.revocation_reason)
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_work_authorization(
  p_branch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_auth_id uuid;
  v_expired_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  IF NOT public.requires_work_authorization(v_user_id, p_branch_id) THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
  END IF;

  IF public.can_user_work(p_branch_id) THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
  END IF;

  UPDATE public.work_authorizations
  SET status = 'expired',
      decided_at = now(),
      decided_by = NULL,
      decision_reason = 'REQUEST_EXPIRED',
      updated_at = now()
  WHERE user_id = v_user_id
    AND branch_id = p_branch_id
    AND status = 'pending'
    AND requested_at <= now() - interval '1 minute'
  RETURNING id INTO v_expired_id;

  IF v_expired_id IS NOT NULL THEN
    INSERT INTO public.work_authorization_events(
      authorization_id, user_id, branch_id, event_type, actor_id, note
    )
    VALUES (
      v_expired_id, v_user_id, p_branch_id, 'expired', NULL, 'REQUEST_EXPIRED'
    );

    PERFORM public.log_audit_action(
      p_branch_id,
      'work_authorization_expired',
      'work_authorization',
      v_expired_id,
      jsonb_build_object('user_id', v_user_id, 'timeout_seconds', 60)
    );
  END IF;

  SELECT wa.id INTO v_auth_id
  FROM public.work_authorizations wa
  WHERE wa.user_id = v_user_id
    AND wa.branch_id = p_branch_id
    AND wa.status = 'pending'
    AND wa.requested_at > now() - interval '1 minute'
  ORDER BY wa.requested_at DESC
  LIMIT 1;

  IF v_auth_id IS NOT NULL THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
  END IF;

  INSERT INTO public.work_authorizations(
    user_id, branch_id, status, requested_by
  )
  VALUES (
    v_user_id, p_branch_id, 'pending', v_user_id
  )
  RETURNING id INTO v_auth_id;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id
  )
  VALUES (
    v_auth_id, v_user_id, p_branch_id, 'requested', v_user_id
  );

  PERFORM public.log_audit_action(
    p_branch_id,
    'work_authorization_requested',
    'work_authorization',
    v_auth_id,
    jsonb_build_object('user_id', v_user_id, 'timeout_seconds', 60)
  );

  RETURN public.get_my_work_authorization_state(p_branch_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_work_authorization(
  p_request_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_row public.work_authorizations%ROWTYPE;
  v_event text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('work.authorization.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT *
  INTO v_row
  FROM public.work_authorizations
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND');
  END IF;

  IF v_row.status = 'pending'
     AND v_row.requested_at <= now() - interval '1 minute' THEN
    UPDATE public.work_authorizations
    SET status = 'expired',
        decided_at = now(),
        decided_by = NULL,
        decision_reason = 'REQUEST_EXPIRED',
        updated_at = now()
    WHERE id = v_row.id;

    INSERT INTO public.work_authorization_events(
      authorization_id, user_id, branch_id, event_type, actor_id, note
    )
    VALUES (
      v_row.id, v_row.user_id, v_row.branch_id, 'expired', NULL, 'REQUEST_EXPIRED'
    );

    PERFORM public.log_audit_action(
      v_row.branch_id,
      'work_authorization_expired',
      'work_authorization',
      v_row.id,
      jsonb_build_object('user_id', v_row.user_id, 'timeout_seconds', 60)
    );

    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_EXPIRED');
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_PENDING');
  END IF;

  IF NOT public.user_may_access_branch(v_row.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  IF v_row.user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_APPROVAL_DENIED');
  END IF;

  IF NOT public.work_authorization_user_has_branch_access(v_row.user_id, v_row.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
  END IF;

  IF NOT p_approve AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  END IF;

  IF p_approve THEN
    UPDATE public.work_authorizations
    SET status = 'approved',
        decided_at = now(),
        decided_by = auth.uid(),
        decision_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
        updated_at = now()
    WHERE id = v_row.id;
    v_event := 'approved';
  ELSE
    UPDATE public.work_authorizations
    SET status = 'rejected',
        decided_at = now(),
        decided_by = auth.uid(),
        decision_reason = btrim(p_reason),
        updated_at = now()
    WHERE id = v_row.id;
    v_event := 'rejected';
  END IF;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id, note
  )
  VALUES (
    v_row.id, v_row.user_id, v_row.branch_id,
    v_event, auth.uid(), NULLIF(btrim(COALESCE(p_reason, '')), '')
  );

  PERFORM public.log_audit_action(
    v_row.branch_id,
    CASE WHEN p_approve THEN 'work_authorization_approved' ELSE 'work_authorization_rejected' END,
    'work_authorization',
    v_row.id,
    jsonb_build_object('user_id', v_row.user_id)
  );

  RETURN jsonb_build_object('success', true, 'authorization_id', v_row.id, 'status', v_event);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_AUTHORIZATION_EXISTS');
END;
$function$;

-- Keep expired requests out of the manager's active pending list even before a
-- user asks again. History remains append-only when expiry is materialized by
-- a new request or by a late manager decision.
CREATE OR REPLACE FUNCTION public.get_work_authorization_snapshot(
  p_branch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_can_manage boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('work.authorization.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;

  v_can_manage := public.can_permission('work.authorization.manage');

  RETURN jsonb_build_object(
    'pending',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wa.id,
        'branchId', wa.branch_id,
        'branchName', b.name,
        'person', jsonb_build_object(
          'userId', u.id,
          'fullName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', ''
        ),
        'status', wa.status,
        'requestedAt', wa.requested_at,
        'decidedAt', wa.decided_at,
        'approverName', NULL,
        'decisionReason', wa.decision_reason,
        'startedAt', NULL
      ) ORDER BY wa.requested_at ASC)
      FROM public.work_authorizations wa
      JOIN public.users u ON u.id = wa.user_id
      JOIN public.branches b ON b.id = wa.branch_id
      WHERE wa.status = 'pending'
        AND wa.requested_at > now() - interval '1 minute'
        AND u.is_active = true
        AND (p_branch_id IS NULL OR wa.branch_id = p_branch_id)
        AND public.user_may_access_branch(wa.branch_id)
    ), '[]'::jsonb),
    'active',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', wa.id,
        'branchId', wa.branch_id,
        'branchName', b.name,
        'person', jsonb_build_object(
          'userId', u.id,
          'fullName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', ''
        ),
        'status', wa.status,
        'requestedAt', wa.requested_at,
        'decidedAt', wa.decided_at,
        'approverName', COALESCE(du.full_name, du.username, du.email),
        'decisionReason', wa.decision_reason,
        'startedAt', wa.decided_at
      ) ORDER BY wa.decided_at DESC)
      FROM public.work_authorizations wa
      JOIN public.users u ON u.id = wa.user_id
      JOIN public.branches b ON b.id = wa.branch_id
      LEFT JOIN public.users du ON du.id = wa.decided_by
      WHERE wa.status = 'approved'
        AND u.is_active = true
        AND (p_branch_id IS NULL OR wa.branch_id = p_branch_id)
        AND public.user_may_access_branch(wa.branch_id)
    ), '[]'::jsonb),
    'history',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'branchId', e.branch_id,
        'branchName', b.name,
        'person', jsonb_build_object(
          'userId', u.id,
          'fullName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', ''
        ),
        'kind', e.event_type,
        'occurredAt', e.created_at,
        'actorName', COALESCE(au.full_name, au.username, au.email),
        'note', e.note
      ) ORDER BY e.created_at DESC)
      FROM (
        SELECT *
        FROM public.work_authorization_events e0
        WHERE (p_branch_id IS NULL OR e0.branch_id = p_branch_id)
          AND public.user_may_access_branch(e0.branch_id)
        ORDER BY e0.created_at DESC
        LIMIT 250
      ) e
      JOIN public.users u ON u.id = e.user_id
      JOIN public.branches b ON b.id = e.branch_id
      LEFT JOIN public.users au ON au.id = e.actor_id
    ), '[]'::jsonb),
    'policies',
    CASE WHEN v_can_manage THEN
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', COALESCE(p.id::text, u.id::text || ':' || b.id::text),
          'branchId', b.id,
          'branchName', b.name,
          'userId', u.id,
          'userName', COALESCE(u.full_name, u.username, u.email),
          'positionLabel', '',
          'requiresAuthorization', COALESCE(p.requires_authorization, false)
        ) ORDER BY b.name, COALESCE(u.full_name, u.username, u.email))
        FROM public.users u
        JOIN public.branches b
          ON (
            u.branch_id = b.id
            OR EXISTS (
              SELECT 1 FROM public.user_branch_access uba
              WHERE uba.user_id = u.id AND uba.branch_id = b.id
            )
          )
        LEFT JOIN public.work_authorization_policies p
          ON p.user_id = u.id AND p.branch_id = b.id
        WHERE u.is_active = true
          AND (p_branch_id IS NULL OR b.id = p_branch_id)
          AND public.user_may_access_branch(b.id)
      ), '[]'::jsonb)
    ELSE '[]'::jsonb END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_cloud_print_job(
  p_job_id uuid,
  p_agent_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
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
  v_requester_can_reprint boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;

  SELECT * INTO v_job FROM public.cloud_print_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'JOB_NOT_FOUND'); END IF;
  IF NOT public.can_execute_cloud_print_kind(v_job.kind) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'print.execute');
  END IF;
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

  IF v_job.kind = 'receipt' AND v_job.sale_id IS NOT NULL THEN
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

    SELECT EXISTS (
      SELECT 1
      FROM public.users u
      LEFT JOIN public.roles r
        ON r.role = u.role
       AND r.is_active = true
      WHERE u.id = v_job.requested_by
        AND u.is_active = true
        AND (
          u.role = 'super_admin'
          OR COALESCE(r.permissions, '[]'::jsonb) ? 'pos.reprint'
        )
    ) INTO v_requester_can_reprint;

    IF v_print_count > 0 AND NOT v_requester_can_reprint THEN
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
      CASE
        WHEN v_print_count > 0 AND NOT v_requester_can_reprint THEN v_job.approval_request_id
        ELSE NULL
      END
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
        'approval_request_id',
          CASE WHEN v_print_count > 0 AND NOT v_requester_can_reprint THEN v_job.approval_request_id ELSE NULL END,
        'direct_reprint_permission', v_requester_can_reprint,
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

REVOKE ALL ON FUNCTION public.get_my_work_authorization_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_work_authorization(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_work_authorization(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_work_authorization_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_work_authorization_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_work_authorization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_work_authorization(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_work_authorization_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_cloud_print_job(uuid, uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
