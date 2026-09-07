-- Shift lifecycle integrity hardening.
-- 1) shift_operations is an accounting ledger: authenticated clients may read it,
--    but all writes must flow through trusted server RPCs.
-- 2) active/normal-close/force-close use one cash equation.
-- 3) force-close and open-drawer use canonical branch scope, including shared access.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.shift_operations FROM authenticated;
GRANT SELECT ON TABLE public.shift_operations TO authenticated;

CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id uuid,
  p_actual_amount numeric,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_shift record;
  v_expected numeric(14,2);
  v_diff numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_uid AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.close') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SHIFT_CLOSE_DENIED',
      'detail', 'Closing shifts requires shifts.close.'
    );
  END IF;

  SELECT s.*
    INTO v_shift
  FROM public.shifts s
  WHERE s.id = p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  IF NOT public.is_pos_admin()
     AND v_shift.cashier_id <> v_uid
     AND NOT public.can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_SHIFT');
  END IF;

  SELECT round(
    COALESCE(v_shift.opening_amount, 0)
    + COALESCE(sum(
      CASE
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type IN ('sale', 'cash_in') THEN op.amount
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type IN ('refund', 'expense', 'cash_out') THEN -op.amount
        ELSE 0
      END
    ), 0),
    2
  )
    INTO v_expected
  FROM public.shift_operations op
  WHERE op.shift_id = p_shift_id;

  v_diff := round(COALESCE(p_actual_amount, v_expected) - v_expected, 2);

  UPDATE public.shifts
  SET status = 'closed',
      closed_at = now(),
      expected_amount = v_expected,
      actual_amount = COALESCE(p_actual_amount, v_expected),
      difference = v_diff,
      notes = COALESCE(p_notes, notes)
  WHERE id = p_shift_id
    AND branch_id = v_shift.branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'expected', v_expected,
    'actual', COALESCE(p_actual_amount, v_expected),
    'difference', v_diff
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_shift(p_branch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user_branch uuid;
  v_target_branch uuid;
  v_shift record;
  v_cash_sales numeric(14,2);
  v_cash_outflows numeric(14,2);
  v_cash_inflows numeric(14,2);
  v_total_sales numeric(14,2);
  v_expected numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  SELECT branch_id INTO v_user_branch
  FROM public.users
  WHERE id = v_uid AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  v_target_branch := COALESCE(p_branch_id, v_user_branch);

  IF v_target_branch IS NOT NULL AND NOT public.user_may_access_branch(v_target_branch) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts s
  WHERE s.status = 'open'
    AND (v_target_branch IS NULL OR s.branch_id = v_target_branch)
    AND public.user_may_access_branch(s.branch_id)
  ORDER BY s.opened_at DESC, s.id DESC
  LIMIT 1;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'open', false);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN operation_type = 'sale' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation_type = 'sale' AND COALESCE(payment_method, 'cash') = 'cash' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation_type = 'cash_in' AND COALESCE(payment_method, 'cash') = 'cash' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN operation_type IN ('expense', 'cash_out', 'refund') AND COALESCE(payment_method, 'cash') = 'cash' THEN amount ELSE 0 END), 0)
  INTO v_total_sales, v_cash_sales, v_cash_inflows, v_cash_outflows
  FROM public.shift_operations
  WHERE shift_id = v_shift.id;

  v_expected := round(
    COALESCE(v_shift.opening_amount, 0) + v_cash_sales + v_cash_inflows - v_cash_outflows,
    2
  );

  RETURN jsonb_build_object(
    'success', true,
    'open', true,
    'shared', true,
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'branch_id', v_shift.branch_id,
      'cashier_id', v_shift.cashier_id,
      'opened_at', v_shift.opened_at,
      'opening_amount', v_shift.opening_amount,
      'expected', v_expected,
      'cash_sales', v_cash_sales,
      'cash_in', v_cash_inflows,
      'cash_out', v_cash_outflows,
      'total_sales', v_total_sales,
      'notes', v_shift.notes
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.force_close_shift(
  p_shift_id uuid,
  p_actual_amount numeric DEFAULT NULL::numeric,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_shift record;
  v_approval_id uuid;
  v_expected numeric(14,2) := 0;
  v_actual numeric(14,2) := 0;
  v_difference numeric(14,2) := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_uid AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT s.id, s.branch_id, s.cashier_id, s.opening_amount, s.status, s.notes
    INTO v_shift
  FROM public.shifts s
  WHERE s.id = p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id))
  FOR UPDATE;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;
  IF v_shift.status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_OPEN');
  END IF;

  IF NOT public.can_permission('approvals.override') THEN
    IF v_shift.cashier_id <> v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_SHIFT_CASHIER');
    END IF;

    SELECT ar.id INTO v_approval_id
    FROM public.approval_requests ar
    WHERE ar.requester_id = v_uid
      AND ar.branch_id = v_shift.branch_id
      AND ar.action_type = 'force_close_shift'
      AND ar.entity_type = 'shift'
      AND ar.entity_id = p_shift_id
      AND ar.status = 'approved'
      AND ar.consumed_at IS NULL
      AND ar.expires_at > now()
      AND (
        p_actual_amount IS NULL
        OR (ar.payload->>'actual_amount')::numeric = p_actual_amount
      )
    ORDER BY ar.decided_at DESC NULLS LAST, ar.created_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_approval_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'APPROVAL_REQUIRED',
        'action_type', 'force_close_shift',
        'entity_type', 'shift',
        'entity_id', p_shift_id,
        'actual_amount', p_actual_amount
      );
    END IF;
  END IF;

  SELECT round(
    COALESCE(v_shift.opening_amount, 0)
    + COALESCE(sum(
      CASE
        WHEN COALESCE(operation_type, '') IN ('sale', 'cash_in')
             AND COALESCE(payment_method, 'cash') = 'cash' THEN amount
        WHEN COALESCE(operation_type, '') IN ('refund', 'expense', 'cash_out')
             AND COALESCE(payment_method, 'cash') = 'cash' THEN -amount
        ELSE 0
      END
    ), 0),
    2
  )
  INTO v_expected
  FROM public.shift_operations
  WHERE shift_id = p_shift_id;

  v_actual := round(COALESCE(p_actual_amount, v_expected), 2);
  IF v_actual < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ACTUAL_AMOUNT');
  END IF;
  v_difference := round(v_actual - v_expected, 2);

  UPDATE public.shifts
  SET status = 'closed',
      closed_at = now(),
      expected_amount = v_expected,
      actual_amount = v_actual,
      difference = v_difference,
      notes = CASE
        WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN notes
        ELSE concat_ws(E'\n', NULLIF(notes, ''), 'Force close: ' || btrim(p_reason))
      END
  WHERE id = p_shift_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORCE_CLOSE_SHIFT_UPDATE_FAILED';
  END IF;

  IF v_approval_id IS NOT NULL THEN
    UPDATE public.approval_requests
    SET status = 'consumed', consumed_at = now()
    WHERE id = v_approval_id
      AND requester_id = v_uid
      AND action_type = 'force_close_shift'
      AND entity_type = 'shift'
      AND entity_id = p_shift_id
      AND status = 'approved'
      AND consumed_at IS NULL
      AND expires_at > now();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FORCE_CLOSE_APPROVAL_CONSUME_FAILED';
    END IF;
  END IF;

  PERFORM public.log_audit_action(
    v_shift.branch_id,
    'force_close_shift',
    'shift',
    p_shift_id,
    jsonb_build_object(
      'cashier_id', v_shift.cashier_id,
      'expected', v_expected,
      'actual', v_actual,
      'difference', v_difference,
      'reason', p_reason,
      'approval_id', v_approval_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'expected', v_expected,
    'actual', v_actual,
    'difference', v_difference,
    'forced', true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_open_drawer(
  p_shift_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_shift record;
  v_approval_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_uid AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT s.id, s.branch_id, s.cashier_id, s.status
    INTO v_shift
  FROM public.shifts s
  WHERE s.id = p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id))
  FOR UPDATE;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;
  IF v_shift.status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_OPEN');
  END IF;

  IF NOT public.can_permission('approvals.override') THEN
    IF v_shift.cashier_id <> v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_SHIFT_CASHIER');
    END IF;

    SELECT ar.id INTO v_approval_id
    FROM public.approval_requests ar
    WHERE ar.requester_id = v_uid
      AND ar.branch_id = v_shift.branch_id
      AND ar.action_type = 'open_drawer'
      AND ar.entity_type = 'shift'
      AND ar.entity_id = p_shift_id
      AND ar.status = 'approved'
      AND ar.consumed_at IS NULL
      AND ar.expires_at > now()
    ORDER BY ar.decided_at DESC NULLS LAST, ar.created_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_approval_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'APPROVAL_REQUIRED',
        'action_type', 'open_drawer',
        'entity_type', 'shift',
        'entity_id', p_shift_id
      );
    END IF;
  END IF;

  IF v_approval_id IS NOT NULL THEN
    UPDATE public.approval_requests
    SET status = 'consumed', consumed_at = now()
    WHERE id = v_approval_id
      AND requester_id = v_uid
      AND action_type = 'open_drawer'
      AND entity_type = 'shift'
      AND entity_id = p_shift_id
      AND status = 'approved'
      AND consumed_at IS NULL
      AND expires_at > now();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OPEN_DRAWER_APPROVAL_CONSUME_FAILED';
    END IF;
  END IF;

  PERFORM public.log_audit_action(
    v_shift.branch_id,
    'open_drawer_authorized',
    'shift',
    p_shift_id,
    jsonb_build_object(
      'cashier_id', v_shift.cashier_id,
      'reason', p_reason,
      'approval_id', v_approval_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'authorized', true,
    'shift_id', p_shift_id,
    'hardware_action_required', true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;
