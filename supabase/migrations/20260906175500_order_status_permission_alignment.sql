-- Align the public order-status RPC with the canonical POS mutation trigger:
-- cancelled => pos.cancel_order, open/held => pos.hold, completed => checkout only.
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
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active = true) THEN
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
    auth.uid(),
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
