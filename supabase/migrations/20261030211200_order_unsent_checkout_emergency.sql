BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $guard0$
DECLARE d text; old text:=$old$  IF p_warehouse_id IS NULL
     OR v_order.inventory_warehouse_id IS DISTINCT FROM p_warehouse_id THEN$old$;
BEGIN
 SELECT pg_get_functiondef('public._prepare_kitchen_sale_settlement(uuid,uuid,uuid,jsonb)'::regprocedure) INTO STRICT d;
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 OR position('ORDER_FULL_SEND_REQUIRED_20261030' IN d)>0 THEN RAISE EXCEPTION 'Order guard source drift'; END IF;
 d:=replace(d,old,$new$  -- ORDER_FULL_SEND_REQUIRED_20261030: check under the existing order lock.
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id=oi.id
    WHERE oi.order_id=p_order_id
      AND oi.quantity>COALESCE(s.sent_quantity,0)+0.000001
  ) THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FULLY_SENT');
  END IF;

  IF p_warehouse_id IS NULL
     OR v_order.inventory_warehouse_id IS DISTINCT FROM p_warehouse_id THEN$new$);
 EXECUTE d;
END;
$guard0$;
DO $guard1$
DECLARE d text; old text:=$old$  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN$old$;
BEGIN
 SELECT pg_get_functiondef('public.enqueue_cloud_open_order_print(uuid,jsonb,text)'::regprocedure) INTO STRICT d;
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 OR position('ORDER_FULL_SEND_REQUIRED_20261030' IN d)>0 THEN RAISE EXCEPTION 'Order guard source drift'; END IF;
 d:=replace(d,old,$new$  -- ORDER_FULL_SEND_REQUIRED_20261030: check under the existing order lock.
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id=oi.id
    WHERE oi.order_id=p_order_id
      AND oi.quantity>COALESCE(s.sent_quantity,0)+0.000001
  ) THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FULLY_SENT');
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN$new$);
 IF position('WHERE o.id=p_order_id;' IN d)=0 THEN RAISE EXCEPTION 'Open print lock source drift'; END IF;
 d:=replace(d,'WHERE o.id=p_order_id;','WHERE o.id=p_order_id FOR UPDATE;');
 EXECUTE d;
END;
$guard1$;
COMMIT;
