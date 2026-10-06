-- Explicit administrative cleanup only. No automatic historical updates.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
CREATE FUNCTION public.finish_empty_kitchen_order(p_order_id uuid,p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=public,pg_temp
AS $function$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('settings.manage') OR NOT public.can_permission('pos.kds_view') OR NOT public.can_permission('pos.kds_update') THEN
    RAISE EXCEPTION 'EMPTY_KDS_ADMIN_REQUIRED';
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
  -- Invoker checks use existing RLS; ensure send rows cannot be hidden by the current-branch policy.
  IF NOT public.is_pos_admin() AND p_branch_id IS DISTINCT FROM public.get_branch_id() THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.id=p_order_id AND o.branch_id=p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF v_order.kitchen_status IN ('served','cancelled') THEN RETURN jsonb_build_object('success',true,'changed',false); END IF;
  IF v_order.status NOT IN ('completed','cancelled') OR (v_order.status='completed' AND COALESCE(v_order.notes,'') NOT LIKE '%Kitchen void:%') THEN
    RAISE EXCEPTION 'EMPTY_KDS_ORDER_NOT_FINAL';
  END IF;
  IF EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=p_order_id)
    OR EXISTS(SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_id=p_order_id) THEN
    RAISE EXCEPTION 'EMPTY_KDS_ORDER_HAS_ITEMS';
  END IF;
  -- The order lock also serializes concurrent sends/item FK checks. Never call void/stock/print handlers.
  UPDATE public.orders SET kitchen_status='cancelled',updated_at=now() WHERE id=p_order_id AND branch_id=p_branch_id;
  INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
  VALUES(auth.uid(),'kitchen_empty_finish','order',p_order_id,jsonb_build_object('from',v_order.kitchen_status,'to','cancelled','reason','closed_voided_order_without_items'),p_branch_id);
  RETURN jsonb_build_object('success',true,'changed',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_empty_kitchen_order(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finish_empty_kitchen_order(uuid,uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.finish_empty_kitchen_order(uuid,uuid) IS 'Admin-only explicit closure of cancelled/paid-voided empty kitchen work under caller RLS; locks order, keeps financial state and all other fields, writes audit. Does not alter ordinary station guards.';
COMMIT;
