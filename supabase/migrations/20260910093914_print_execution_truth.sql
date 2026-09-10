-- Receipt print truth: authorization must never be recorded as a completed print.
-- A print event is persisted only by record_sale_print after the client has
-- successfully opened/accepted the print path.

CREATE OR REPLACE FUNCTION public.authorize_sale_print(
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
  v_count integer;
  v_req public.approval_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
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
    WHERE id = p_approval_request_id;

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
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'print_number', v_count + 1,
    'is_reprint', (v_count > 0),
    'approval_request_id', p_approval_request_id
  );
END
$function$;

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

  -- Serialize print-number assignment and re-check permissions at commit time.
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
    CASE WHEN v_count = 0 THEN 'SALE_PRINTED' ELSE 'SALE_REPRINTED' END,
    'sale',
    p_sale_id,
    jsonb_build_object(
      'print_number', v_count + 1,
      'approval_request_id', p_approval_request_id,
      'execution_confirmed_by_client', true
    ),
    v_sale.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'print_number', v_count + 1,
    'is_reprint', (v_count > 0)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.authorize_sale_print(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_sale_print(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.authorize_sale_print(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.record_sale_print(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_sale_print(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_sale_print(uuid, uuid) TO authenticated;
