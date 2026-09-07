-- Stage 4.2 follow-up: close RPC ownership bypasses discovered by integration gates.
-- Existing function signatures are preserved; only authorization order and scope are tightened.

CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id uuid,
  p_status text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF p_status NOT IN ('open','held','completed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Ownership is intentionally checked before exposing order-state details or
  -- evaluating action-specific policy such as sent-item cancellation rules.
  IF NOT public.is_pos_admin() AND v_order.cashier_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
  END IF;

  IF v_order.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_CLOSED');
  END IF;

  -- Financial completion belongs only to process_sale/process_sale_split.
  IF p_status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'COMPLETION_REQUIRES_PAYMENT',
      'detail', 'Complete the order through the controlled payment flow.'
    );
  END IF;

  IF p_status = 'cancelled' THEN
    IF NOT public.can_permission('pos.cancel_order') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.cancel_order');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.order_kitchen_sends oks
      JOIN public.order_items oi ON oi.id = oks.order_item_id
      WHERE oi.order_id = p_order_id
        AND COALESCE(oks.sent_quantity,0) > 0
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID',
        'detail', 'Cancel sent items through the audited void flow before cancelling the order.'
      );
    END IF;

    IF p_notes IS NULL OR length(trim(p_notes)) < 3 THEN
      RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
    END IF;
  ELSE
    IF NOT public.can_permission('pos.hold') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.hold');
    END IF;
  END IF;

  UPDATE public.orders
  SET status = p_status,
      updated_at = now(),
      completed_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE NULL END,
      notes = COALESCE(NULLIF(trim(p_notes),''), notes)
  WHERE id = p_order_id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.dining_tables
    SET status = CASE WHEN p_status = 'cancelled' THEN 'vacant' ELSE 'occupied' END,
        updated_at = now()
    WHERE id = v_order.table_id;
  END IF;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    CASE WHEN p_status = 'cancelled' THEN 'ORDER_CANCELLED' ELSE 'ORDER_STATUS_CHANGED' END,
    'order',
    p_order_id,
    jsonb_build_object('from_status',v_order.status,'to_status',p_status,'reason',p_notes),
    v_order.branch_id
  );

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_order_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_order_item_to_table(
  p_order_id uuid,
  p_order_item_id uuid,
  p_target_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_target public.dining_tables%ROWTYPE;
  v_target_order_id uuid;
  v_target_order_number text;
  v_target_owner_id uuid;
  v_number jsonb;
  v_new_item_id uuid;
  v_remaining integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND status IN ('open', 'held')
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF NOT public.is_pos_admin() THEN
    IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
    END IF;
    IF NOT public.can_permission('pos.order.transfer') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.transfer');
    END IF;
  END IF;

  IF v_order.table_id IS NULL OR v_order.order_type <> 'dine_in' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_DINE_IN');
  END IF;

  SELECT * INTO v_item
  FROM public.order_items
  WHERE id = p_order_item_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_ITEM_NOT_FOUND');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_kitchen_sends s
    WHERE s.order_item_id = p_order_item_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ITEM_ALREADY_SENT',
      'detail', 'Sent kitchen lines cannot be transferred between orders.'
    );
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

  IF v_target.id = v_order.table_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_TABLE');
  END IF;

  SELECT id, order_number, cashier_id
    INTO v_target_order_id, v_target_order_number, v_target_owner_id
  FROM public.orders
  WHERE table_id = p_target_table_id
    AND branch_id = v_order.branch_id
    AND status IN ('open', 'held')
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_target_order_id IS NOT NULL
     AND NOT public.is_pos_admin()
     AND v_target_owner_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_ORDER_OPERATOR_REQUIRED');
  END IF;

  IF v_target_order_id IS NULL THEN
    v_number := public.next_document_number('order');
    IF COALESCE((v_number->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', 'NUMBERING_FAILED', 'detail', v_number->>'error');
    END IF;

    v_target_order_number := v_number->>'number';

    INSERT INTO public.orders (
      order_number, branch_id, order_type, status, table_id, customer_id,
      cashier_id, guest_count, notes, subtotal, discount_amount, discount_type,
      tax_amount, total
    )
    VALUES (
      v_target_order_number,
      v_order.branch_id,
      'dine_in',
      'open',
      p_target_table_id,
      v_order.customer_id,
      COALESCE(v_order.cashier_id, v_uid),
      NULL,
      NULL,
      0, 0, 'amount', 0, 0
    )
    RETURNING id INTO v_target_order_id;
  END IF;

  INSERT INTO public.order_items (
    order_id, product_id, unit_name, quantity, unit_price, discount_amount,
    bonus_quantity, total, modifier_option_ids, modifiers_snapshot, notes
  )
  VALUES (
    v_target_order_id,
    v_item.product_id,
    v_item.unit_name,
    v_item.quantity,
    v_item.unit_price,
    v_item.discount_amount,
    v_item.bonus_quantity,
    v_item.total,
    COALESCE(v_item.modifier_option_ids, '{}'::uuid[]),
    COALESCE(v_item.modifiers_snapshot, '[]'::jsonb),
    v_item.notes
  )
  RETURNING id INTO v_new_item_id;

  DELETE FROM public.order_items WHERE id = p_order_item_id;

  UPDATE public.dining_tables
  SET status = 'occupied', updated_at = now()
  WHERE id = p_target_table_id;

  SELECT count(*) INTO v_remaining
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_remaining = 0 THEN
    UPDATE public.orders
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_order_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = v_order.table_id
        AND status IN ('open', 'held')
        AND id <> p_order_id
    ) THEN
      UPDATE public.dining_tables
      SET status = 'vacant', updated_at = now()
      WHERE id = v_order.table_id;
    END IF;
  END IF;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    'ORDER_ITEM_TABLE_TRANSFERRED',
    'order_item',
    p_order_item_id,
    jsonb_build_object(
      'source_order_id', p_order_id,
      'target_order_id', v_target_order_id,
      'source_table_id', v_order.table_id,
      'target_table_id', p_target_table_id,
      'new_order_item_id', v_new_item_id
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'source_order_id', p_order_id,
    'target_order_id', v_target_order_id,
    'target_order_number', v_target_order_number,
    'new_order_item_id', v_new_item_id,
    'source_order_empty', v_remaining = 0,
    'inventory_changed', false,
    'kds_changed', false
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_order_item_to_table(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_order_item_to_table(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_item_to_table(uuid, uuid, uuid) TO authenticated, service_role;
