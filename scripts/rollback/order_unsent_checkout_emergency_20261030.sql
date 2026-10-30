BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $restore0$
DECLARE d text; needle text:=$block$  -- ORDER_FULL_SEND_REQUIRED_20261030: check under the existing order lock.
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id=oi.id
    WHERE oi.order_id=p_order_id
      AND oi.quantity>COALESCE(s.sent_quantity,0)+0.000001
  ) THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FULLY_SENT');
  END IF;

$block$;
BEGIN
 SELECT pg_get_functiondef('public._prepare_kitchen_sale_settlement(uuid,uuid,uuid,jsonb)'::regprocedure) INTO STRICT d;
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Order guard rollback source drift'; END IF;
 d:=replace(d,needle,'');
 EXECUTE d;
END;
$restore0$;
DO $restore1$
DECLARE d text; needle text:=$block$  -- ORDER_FULL_SEND_REQUIRED_20261030: check under the existing order lock.
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id=oi.id
    WHERE oi.order_id=p_order_id
      AND oi.quantity>COALESCE(s.sent_quantity,0)+0.000001
  ) THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FULLY_SENT');
  END IF;

$block$;
BEGIN
 SELECT pg_get_functiondef('public.enqueue_cloud_open_order_print(uuid,jsonb,text)'::regprocedure) INTO STRICT d;
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Order guard rollback source drift'; END IF;
 d:=replace(d,needle,'');
 d:=replace(d,'WHERE o.id=p_order_id FOR UPDATE;','WHERE o.id=p_order_id;');
 EXECUTE d;
END;
$restore1$;
COMMIT;
