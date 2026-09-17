-- Shift close operational safety:
-- - normal close fails closed while effective open/held orders remain in the branch;
-- - a separate Permission-First override may close the drawer/shift while preserving those orders/tables;
-- - neither path mutates orders or dining table occupancy.

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
  v_open_order_count integer := 0;
  v_open_table_count integer := 0;
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

  SELECT
    count(*)::integer,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::integer
  INTO v_open_order_count, v_open_table_count
  FROM public.orders o
  WHERE o.branch_id = v_shift.branch_id
    AND o.status IN ('open', 'held')
    AND COALESCE(o.payment_status, 'unpaid') <> 'paid'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND oi.quantity > 0
    );

  IF v_open_order_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE',
      'detail', 'Resolve open or held orders before normal shift close, or use the separately-permitted open-orders override.',
      'open_order_count', v_open_order_count,
      'open_table_count', v_open_table_count
    );
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
    AND branch_id = v_shift.branch_id
    AND status = 'open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'expected', v_expected,
    'actual', COALESCE(p_actual_amount, v_expected),
    'difference', v_diff,
    'open_orders_preserved', false
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_shift_with_open_orders(
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
  v_open_order_count integer := 0;
  v_open_table_count integer := 0;
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

  IF NOT public.is_pos_admin()
     AND (
       NOT public.can_permission('shifts.close')
       OR NOT public.can_permission('shifts.close_with_open_orders')
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'SHIFT_CLOSE_OPEN_ORDERS_DENIED',
      'detail', 'Closing a shift while open orders remain requires shifts.close and shifts.close_with_open_orders.'
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

  SELECT
    count(*)::integer,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::integer
  INTO v_open_order_count, v_open_table_count
  FROM public.orders o
  WHERE o.branch_id = v_shift.branch_id
    AND o.status IN ('open', 'held')
    AND COALESCE(o.payment_status, 'unpaid') <> 'paid'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND oi.quantity > 0
    );

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
      notes = CASE
        WHEN v_open_order_count = 0 THEN COALESCE(p_notes, notes)
        ELSE concat_ws(
          E'\n',
          NULLIF(COALESCE(p_notes, notes), ''),
          format('Closed with %s open/held operational order(s) preserved for the next shift.', v_open_order_count)
        )
      END
  WHERE id = p_shift_id
    AND branch_id = v_shift.branch_id
    AND status = 'open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  PERFORM public.log_audit_action(
    v_shift.branch_id,
    'shift_close_with_open_orders',
    'shift',
    p_shift_id,
    jsonb_build_object(
      'cashier_id', v_shift.cashier_id,
      'expected', v_expected,
      'actual', COALESCE(p_actual_amount, v_expected),
      'difference', v_diff,
      'open_order_count', v_open_order_count,
      'open_table_count', v_open_table_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'expected', v_expected,
    'actual', COALESCE(p_actual_amount, v_expected),
    'difference', v_diff,
    'open_orders_preserved', v_open_order_count > 0,
    'open_order_count', v_open_order_count,
    'open_table_count', v_open_table_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'UNKNOWN_ERROR', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.close_shift_with_open_orders(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_open_orders(uuid, numeric, text) TO authenticated, service_role;
