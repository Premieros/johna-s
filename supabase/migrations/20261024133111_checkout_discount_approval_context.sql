BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.set_order_checkout_discount(uuid,numeric,uuid)'::regprocedure)<>'ff4744c617c967faa4445f6db611bc2c'
 THEN RAISE EXCEPTION 'CHECKOUT_DISCOUNT_APPROVAL_SOURCE_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.set_order_checkout_discount(p_order_id uuid, p_discount_amount numeric, p_approval_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_preview jsonb;
  v_discount numeric(14,2);
  v_budget numeric(14,2);
  v_tax numeric(14,2);
  v_tax_enabled boolean;
  v_tax_rate numeric;
  v_action_context jsonb;
  v_context_key text;
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
  -- Reuse the existing, branch-scoped payment authority for this exact order.
  -- A cashier need not own the order to apply their exact manager approval.
  SELECT jsonb_object_agg(key,COALESCE(current_setting(key,true),'')) INTO v_action_context
  FROM unnest(ARRAY['app.pos_action_authorized','app.pos_action_actor_id','app.pos_action_order_id','app.pos_action_permission']) key;
  BEGIN
    PERFORM set_config('app.pos_action_authorized','1',true);
    PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
    PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
    PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
  UPDATE public.orders SET discount_amount=v_budget,discount_type='amount',
    tax_amount=v_tax,total=greatest(subtotal-v_budget,0)+v_tax,updated_at=now()
    WHERE id=p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_DISCOUNT_UPDATE_DENIED'; END IF;
  v_preview := public.get_order_settlement_preview(p_order_id);
  IF COALESCE((v_preview->>'success')::boolean,false) IS NOT TRUE
     OR (v_preview->>'discount_amount')::numeric IS DISTINCT FROM v_discount THEN
    RAISE EXCEPTION 'ORDER_DISCOUNT_PREVIEW_MISMATCH';
  END IF;
  EXCEPTION WHEN OTHERS THEN
    FOR v_context_key IN SELECT jsonb_object_keys(v_action_context) LOOP
      PERFORM set_config(v_context_key,v_action_context->>v_context_key,true);
    END LOOP;
    RAISE;
  END;
  FOR v_context_key IN SELECT jsonb_object_keys(v_action_context) LOOP
    PERFORM set_config(v_context_key,v_action_context->>v_context_key,true);
  END LOOP;
  RETURN v_preview;
END;
$function$;

COMMIT;
