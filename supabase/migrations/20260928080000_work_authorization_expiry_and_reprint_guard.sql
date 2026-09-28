-- One-minute work authorization requests + direct reprint queue token.
-- Does NOT modify frozen Print Agent claim/start/complete RPCs.

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
  v_expired public.work_authorizations%ROWTYPE;
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

  FOR v_expired IN
    UPDATE public.work_authorizations
    SET status = 'rejected',
        decided_at = now(),
        decided_by = NULL,
        decision_reason = 'REQUEST_EXPIRED',
        updated_at = now()
    WHERE user_id = v_user_id
      AND branch_id = p_branch_id
      AND status = 'pending'
      AND requested_at <= now() - interval '1 minute'
    RETURNING *
  LOOP
    INSERT INTO public.work_authorization_events(
      authorization_id, user_id, branch_id, event_type, actor_id, note
    ) VALUES (
      v_expired.id, v_expired.user_id, v_expired.branch_id,
      'rejected', NULL, 'REQUEST_EXPIRED'
    );

    PERFORM public.log_audit_action(
      v_expired.branch_id,
      'work_authorization_expired',
      'work_authorization',
      v_expired.id,
      jsonb_build_object('user_id', v_expired.user_id, 'reason', 'REQUEST_EXPIRED')
    );
  END LOOP;

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

  INSERT INTO public.work_authorizations(user_id, branch_id, status, requested_by)
  VALUES (v_user_id, p_branch_id, 'pending', v_user_id)
  RETURNING id INTO v_auth_id;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id
  ) VALUES (
    v_auth_id, v_user_id, p_branch_id, 'requested', v_user_id
  );

  PERFORM public.log_audit_action(
    p_branch_id,
    'work_authorization_requested',
    'work_authorization',
    v_auth_id,
    jsonb_build_object('user_id', v_user_id, 'expires_in_seconds', 60)
  );

  RETURN public.get_my_work_authorization_state(p_branch_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN public.get_my_work_authorization_state(p_branch_id);
END;
$function$;

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

  SELECT * INTO v_row
  FROM public.work_authorizations
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND'); END IF;
  IF v_row.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_PENDING'); END IF;
  IF NOT public.user_may_access_branch(v_row.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED'); END IF;
  IF v_row.user_id = auth.uid() THEN RETURN jsonb_build_object('success', false, 'error', 'SELF_APPROVAL_DENIED'); END IF;
  IF NOT public.work_authorization_user_has_branch_access(v_row.user_id, v_row.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_OUT_OF_SCOPE');
  END IF;

  IF v_row.requested_at <= now() - interval '1 minute' THEN
    UPDATE public.work_authorizations
    SET status = 'rejected', decided_at = now(), decided_by = NULL,
        decision_reason = 'REQUEST_EXPIRED', updated_at = now()
    WHERE id = v_row.id;

    INSERT INTO public.work_authorization_events(
      authorization_id, user_id, branch_id, event_type, actor_id, note
    ) VALUES (
      v_row.id, v_row.user_id, v_row.branch_id, 'rejected', NULL, 'REQUEST_EXPIRED'
    );

    PERFORM public.log_audit_action(
      v_row.branch_id, 'work_authorization_expired', 'work_authorization', v_row.id,
      jsonb_build_object('user_id', v_row.user_id, 'reason', 'REQUEST_EXPIRED')
    );

    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_EXPIRED');
  END IF;

  IF NOT p_approve AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  END IF;

  IF p_approve THEN
    UPDATE public.work_authorizations
    SET status = 'approved', decided_at = now(), decided_by = auth.uid(),
        decision_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), updated_at = now()
    WHERE id = v_row.id;
    v_event := 'approved';
  ELSE
    UPDATE public.work_authorizations
    SET status = 'rejected', decided_at = now(), decided_by = auth.uid(),
        decision_reason = btrim(p_reason), updated_at = now()
    WHERE id = v_row.id;
    v_event := 'rejected';
  END IF;

  INSERT INTO public.work_authorization_events(
    authorization_id, user_id, branch_id, event_type, actor_id, note
  ) VALUES (
    v_row.id, v_row.user_id, v_row.branch_id,
    v_event, auth.uid(), NULLIF(btrim(COALESCE(p_reason, '')), '')
  );

  PERFORM public.log_audit_action(
    v_row.branch_id,
    CASE WHEN p_approve THEN 'work_authorization_approved' ELSE 'work_authorization_rejected' END,
    'work_authorization', v_row.id,
    jsonb_build_object('user_id', v_row.user_id)
  );

  RETURN jsonb_build_object('success', true, 'authorization_id', v_row.id, 'status', v_event);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_AUTHORIZATION_EXISTS');
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_cloud_receipt_print(
  p_sale_id uuid,
  p_approval_request_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_auth jsonb;
  v_job public.cloud_print_jobs%ROWTYPE;
  v_existing public.cloud_print_jobs%ROWTYPE;
  v_key text;
  v_effective_approval_id uuid := p_approval_request_id;
  v_direct_reprint boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYLOAD');
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(v_sale.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT public.authorize_sale_print(p_sale_id, p_approval_request_id) INTO v_auth;
  IF COALESCE((v_auth->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_auth; END IF;

  SELECT * INTO v_existing
  FROM public.cloud_print_jobs
  WHERE sale_id = p_sale_id
    AND branch_id = v_sale.branch_id
    AND kind = 'receipt'
    AND (
      status IN ('pending', 'claimed', 'printing')
      OR (status = 'failed' AND attempts < 5)
    )
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true, 'job_id', v_existing.id, 'status', v_existing.status,
      'print_number', v_existing.expected_print_number, 'deduplicated', true
    );
  END IF;

  IF COALESCE((v_auth->>'is_reprint')::boolean, false)
     AND v_effective_approval_id IS NULL
     AND public.can_permission('pos.reprint')
  THEN
    INSERT INTO public.approval_requests(
      branch_id, requester_id, action_type, entity_type, entity_id,
      payload, reason, status, approver_id, decision_note, decided_at, expires_at
    ) VALUES (
      v_sale.branch_id, auth.uid(), 'reprint', 'sale', p_sale_id,
      jsonb_build_object(
        'source', 'direct_reprint_permission',
        'permission', 'pos.reprint',
        'automatic', true
      ),
      'DIRECT_REPRINT_PERMISSION',
      'approved',
      auth.uid(),
      'pos.reprint direct authorization',
      now(),
      now() + interval '10 minutes'
    )
    RETURNING id INTO v_effective_approval_id;
    v_direct_reprint := true;
  END IF;

  v_key := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    'receipt:' || p_sale_id::text || ':' || COALESCE(v_auth->>'print_number', '1')
  );

  BEGIN
    INSERT INTO public.cloud_print_jobs(
      branch_id, requested_by, kind, station_code, payload, sale_id,
      approval_request_id, expected_print_number, idempotency_key
    ) VALUES (
      v_sale.branch_id, auth.uid(), 'receipt', 'cashier', p_payload, p_sale_id,
      v_effective_approval_id, (v_auth->>'print_number')::integer, v_key
    )
    ON CONFLICT (branch_id, idempotency_key) DO UPDATE
    SET updated_at = public.cloud_print_jobs.updated_at
    RETURNING * INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.cloud_print_jobs
    WHERE sale_id = p_sale_id
      AND branch_id = v_sale.branch_id
      AND kind = 'receipt'
      AND (
        status IN ('pending', 'claimed', 'printing')
        OR (status = 'failed' AND attempts < 5)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    IF v_existing.id IS NULL THEN RAISE; END IF;
    v_job := v_existing;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'job_id', v_job.id,
    'status', v_job.status,
    'print_number', v_job.expected_print_number,
    'deduplicated', v_job.id IS DISTINCT FROM NULL AND v_job.id = v_existing.id,
    'direct_reprint', v_direct_reprint
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_work_authorization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_work_authorization(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_work_authorization_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_work_authorization_snapshot(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.decide_work_authorization(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_work_authorization(uuid, boolean, text) TO authenticated;
REVOKE ALL ON FUNCTION public.enqueue_cloud_receipt_print(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_receipt_print(uuid, uuid, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
