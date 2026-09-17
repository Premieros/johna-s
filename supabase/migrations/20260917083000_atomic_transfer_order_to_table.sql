-- Atomic full-order table transfer.
-- Keeps transfer permission/branch/ownership checks on the server and updates
-- order + source/target table states inside one PostgreSQL transaction.

CREATE OR REPLACE FUNCTION public.transfer_order_to_table(
  p_order_id uuid,
  p_target_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_source public.dining_tables%ROWTYPE;
  v_target public.dining_tables%ROWTYPE;
  v_source_still_occupied boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERMISSION_DENIED',
      'permission', 'pos.order.transfer'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  IF v_order.status NOT IN ('open', 'held') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_CLOSED');
  END IF;

  IF v_order.order_type <> 'dine_in' OR v_order.table_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_DINE_IN');
  END IF;

  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_order.cashier_id IS DISTINCT FROM v_uid
     AND NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
  END IF;

  IF p_target_table_id = v_order.table_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_TABLE');
  END IF;

  -- Lock source first, then target, to keep the state transition deterministic.
  SELECT * INTO v_source
  FROM public.dining_tables
  WHERE id = v_order.table_id
    AND branch_id = v_order.branch_id
  FOR UPDATE;

  IF v_source.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_TABLE_NOT_FOUND');
  END IF;

  SELECT * INTO v_target
  FROM public.dining_tables
  WHERE id = p_target_table_id
    AND branch_id = v_order.branch_id
    AND is_active = true
  FOR UPDATE;

  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_TABLE_NOT_FOUND');
  END IF;

  -- Full-order transfer is not merge. A target with another live order must be rejected.
  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = p_target_table_id
      AND o.branch_id = v_order.branch_id
      AND o.status IN ('open', 'held')
      AND o.id <> p_order_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_TABLE_OCCUPIED');
  END IF;

  UPDATE public.orders
  SET table_id = p_target_table_id,
      updated_at = now()
  WHERE id = p_order_id;

  UPDATE public.dining_tables
  SET status = 'occupied',
      updated_at = now()
  WHERE id = p_target_table_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.table_id = v_source.id
      AND o.branch_id = v_order.branch_id
      AND o.status IN ('open', 'held')
      AND o.id <> p_order_id
  ) INTO v_source_still_occupied;

  UPDATE public.dining_tables
  SET status = CASE WHEN v_source_still_occupied THEN 'occupied' ELSE 'vacant' END,
      updated_at = now()
  WHERE id = v_source.id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    'ORDER_TABLE_TRANSFERRED',
    'order',
    p_order_id,
    jsonb_build_object(
      'source_table_id', v_source.id,
      'target_table_id', p_target_table_id,
      'source_status_after', CASE WHEN v_source_still_occupied THEN 'occupied' ELSE 'vacant' END,
      'target_status_after', 'occupied'
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'source_table_id', v_source.id,
    'target_table_id', p_target_table_id,
    'source_table_status', CASE WHEN v_source_still_occupied THEN 'occupied' ELSE 'vacant' END,
    'target_table_status', 'occupied'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_to_table(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_order_to_table(uuid, uuid) TO authenticated;
