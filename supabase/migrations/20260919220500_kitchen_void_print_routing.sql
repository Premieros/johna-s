-- Print an explicit cancellation ticket for every approved kitchen void.
-- The ticket is routed through the same branch/category kitchen station used by
-- normal kitchen sends. This does not mutate sales, payments, inventory, or the
-- existing print-agent protocol.

CREATE OR REPLACE FUNCTION public.enqueue_kitchen_void_print()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_station_code text;
  v_order_number text;
  v_text text;
  v_idempotency_key text;
BEGIN
  SELECT lower(btrim(ks.code))
  INTO v_station_code
  FROM public.products p
  JOIN public.categories c
    ON c.id = p.category_id
   AND c.branch_id = NEW.branch_id
  JOIN public.kitchen_stations ks
    ON ks.id = c.kitchen_station_id
   AND ks.branch_id = NEW.branch_id
   AND ks.is_active = true
  WHERE p.id = NEW.product_id
    AND lower(btrim(ks.code)) <> 'cashier'
  LIMIT 1;

  -- Never guess a printer route and never block the business cancellation.
  -- A missing route is recorded for operators/admins to diagnose.
  IF COALESCE(v_station_code, '') = '' THEN
    INSERT INTO public.audit_log(
      user_id, action, entity, entity_id, details, branch_id
    ) VALUES (
      NEW.voided_by,
      'KITCHEN_VOID_PRINT_ROUTE_MISSING',
      'order_kitchen_void',
      NEW.id,
      jsonb_build_object(
        'order_id', NEW.order_id,
        'order_item_id', NEW.order_item_id,
        'product_id', NEW.product_id,
        'product_name', NEW.product_name
      ),
      NEW.branch_id
    );
    RETURN NEW;
  END IF;

  SELECT o.order_number::text
  INTO v_order_number
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  v_text :=
      '*** إلغاء / VOID ***' || E'\n'
    || 'طلب: ' || COALESCE(v_order_number, NEW.order_id::text) || E'\n'
    || 'الصنف: ' || NEW.product_name || E'\n'
    || 'الكمية الملغاة: ' || trim(to_char(NEW.quantity, 'FM999999990.####')) || E'\n'
    || 'السبب: ' || NEW.reason || E'\n'
    || '----------------';

  v_idempotency_key := 'kitchen-void:' || NEW.id::text || ':' || v_station_code;

  INSERT INTO public.cloud_print_jobs(
    branch_id,
    requested_by,
    kind,
    station_code,
    payload,
    idempotency_key
  ) VALUES (
    NEW.branch_id,
    NEW.voided_by,
    'kitchen',
    v_station_code,
    jsonb_build_object(
      'text', v_text,
      'event', 'kitchen_void',
      'void_id', NEW.id,
      'order_id', NEW.order_id,
      'order_item_id', NEW.order_item_id,
      'product_id', NEW.product_id,
      'product_name', NEW.product_name,
      'quantity', NEW.quantity,
      'reason', NEW.reason,
      'station_code', v_station_code
    ),
    v_idempotency_key
  )
  ON CONFLICT (branch_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_kitchen_void_print()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_kitchen_void_print()
  TO service_role, postgres;

DROP TRIGGER IF EXISTS trg_enqueue_kitchen_void_print
  ON public.order_kitchen_voids;
CREATE TRIGGER trg_enqueue_kitchen_void_print
AFTER INSERT
ON public.order_kitchen_voids
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_kitchen_void_print();

NOTIFY pgrst, 'reload schema';
