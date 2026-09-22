-- Restore the explicit Permission-First shift-close override.
-- The override closes only the drawer/shift and preserves open orders/tables.
-- It does not mutate, pay, cancel or complete any operational order.

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
  v_shift public.shifts%ROWTYPE;
  v_expected numeric(14,2);
  v_diff numeric(14,2);
  v_open_order_count integer := 0;
  v_open_table_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id=v_uid
      AND u.is_active=true
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
      'detail', 'Closing a shift with open orders requires shifts.close and shifts.close_with_open_orders.'
    );
  END IF;

  SELECT s.*
  INTO v_shift
  FROM public.shifts s
  WHERE s.id=p_shift_id
    AND (public.is_pos_admin() OR public.user_may_access_branch(s.branch_id))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;

  IF v_shift.status='closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  IF NOT public.is_pos_admin()
     AND v_shift.cashier_id<>v_uid
     AND NOT public.can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_SHIFT');
  END IF;

  SELECT
    count(*)::int,
    count(DISTINCT o.table_id) FILTER (WHERE o.table_id IS NOT NULL)::int
  INTO v_open_order_count,v_open_table_count
  FROM public.orders o
  WHERE o.branch_id=v_shift.branch_id
    AND o.status IN ('open','held')
    AND COALESCE(o.payment_status,'unpaid')<>'paid'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id
        AND oi.quantity>0
    );

  v_expected:=public._compute_shift_expected_cash(p_shift_id);
  v_diff:=round(COALESCE(p_actual_amount,v_expected)-v_expected,2);

  UPDATE public.shifts
  SET status='closed',
      closed_at=now(),
      expected_amount=v_expected,
      actual_amount=COALESCE(p_actual_amount,v_expected),
      difference=v_diff,
      notes=CASE
        WHEN v_open_order_count=0 THEN COALESCE(p_notes,notes)
        ELSE concat_ws(
          E'\n',
          NULLIF(COALESCE(p_notes,notes),''),
          format('Closed with %s open/held operational order(s) preserved for the next shift.',v_open_order_count)
        )
      END
  WHERE id=p_shift_id
    AND branch_id=v_shift.branch_id
    AND status='open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSED');
  END IF;

  PERFORM public.log_audit_action(
    v_shift.branch_id,
    'shift_close_with_open_orders',
    'shift',
    p_shift_id,
    jsonb_build_object(
      'cashier_id',v_shift.cashier_id,
      'expected',v_expected,
      'actual',COALESCE(p_actual_amount,v_expected),
      'difference',v_diff,
      'open_order_count',v_open_order_count,
      'open_table_count',v_open_table_count,
      'orders_preserved',true
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'shift_id',p_shift_id,
    'expected',v_expected,
    'actual',COALESCE(p_actual_amount,v_expected),
    'difference',v_diff,
    'open_orders_preserved',v_open_order_count>0,
    'open_order_count',v_open_order_count,
    'open_table_count',v_open_table_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','UNKNOWN_ERROR','detail',SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_shift_with_open_orders(uuid,numeric,text) TO authenticated,service_role;
