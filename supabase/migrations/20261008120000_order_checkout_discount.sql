-- Header-only checkout discount: existing RLS and mutation guards remain in force.
-- Approval is consumed by process_sale, never by this preview preparation step.
CREATE FUNCTION public.set_order_checkout_discount(
  p_order_id uuid, p_discount_amount numeric, p_approval_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_preview jsonb;
  v_discount numeric(14,2);
  v_budget numeric(14,2);
  v_tax numeric(14,2);
  v_tax_enabled boolean;
  v_tax_rate numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.order.edit') OR NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  v_preview := public.get_order_settlement_preview(p_order_id);
  IF COALESCE((v_preview->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_preview; END IF;
  IF COALESCE((v_preview->>'pending_quantity')::numeric,0)<=0 THEN
    RETURN jsonb_build_object('success',false,'error','NO_SENT_ITEMS_TO_SETTLE');
  END IF;
  IF p_discount_amount IS NULL OR p_discount_amount < 0
     OR p_discount_amount > (v_preview->>'subtotal')::numeric THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_DISCOUNT');
  END IF;
  v_discount := round(p_discount_amount,2);
  IF NOT public.can_permission('pos.discount') AND NOT EXISTS (
    SELECT 1 FROM public.approval_requests r
    WHERE r.id=p_approval_request_id AND r.requester_id=auth.uid()
      AND r.branch_id=v_order.branch_id AND r.action_type='discount'
      AND r.entity_type='order' AND r.entity_id=p_order_id
      AND r.status='approved' AND r.expires_at>now() AND r.consumed_at IS NULL
      AND round((r.payload->>'discount_amount')::numeric,2)=v_discount
      AND round((r.payload->>'subtotal')::numeric,2)=(v_preview->>'subtotal')::numeric
  ) THEN
    RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED');
  END IF;
  -- Keep the budget already allocated to previous partial settlements.
  v_budget := greatest(COALESCE(v_order.discount_amount,0)
    - (v_preview->>'discount_amount')::numeric,0) + v_discount;
  SELECT t.tax_enabled,t.tax_rate INTO v_tax_enabled,v_tax_rate
    FROM public._effective_branch_tax(v_order.branch_id) t;
  v_tax := CASE WHEN COALESCE(v_tax_enabled,false)
    THEN round(greatest(v_order.subtotal-v_budget,0)*COALESCE(v_tax_rate,0)/100,2) ELSE 0 END;
  UPDATE public.orders SET discount_amount=v_budget,discount_type='amount',
    tax_amount=v_tax,total=greatest(subtotal-v_budget,0)+v_tax,updated_at=now()
    WHERE id=p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_DISCOUNT_UPDATE_DENIED'; END IF;
  v_preview := public.get_order_settlement_preview(p_order_id);
  IF COALESCE((v_preview->>'success')::boolean,false) IS NOT TRUE
     OR (v_preview->>'discount_amount')::numeric IS DISTINCT FROM v_discount THEN
    RAISE EXCEPTION 'ORDER_DISCOUNT_PREVIEW_MISMATCH';
  END IF;
  RETURN v_preview;
END;
$$;
REVOKE ALL ON FUNCTION public.set_order_checkout_discount(uuid,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_order_checkout_discount(uuid,numeric,uuid) TO authenticated;
