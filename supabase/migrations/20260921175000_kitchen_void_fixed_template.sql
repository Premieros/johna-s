-- Unify approved kitchen VOID tickets with the fixed thermal kitchen template.
--
-- Safety boundaries:
-- - preserves the existing product/category kitchen-station routing;
-- - preserves the existing idempotency key;
-- - preserves the text payload as a fallback for older/local transports;
-- - does not mutate orders, sales, payments, inventory, stations or printer config;
-- - only enriches newly-created VOID print jobs with fixed template v1.

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
  v_template jsonb;
  v_quantity_text text;
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

  v_quantity_text := trim(to_char(NEW.quantity, 'FM999999990.####'));

  -- Keep the proven text transport as a compatibility fallback.
  v_text :=
      '*** إلغاء / VOID ***' || E'\n'
    || 'طلب: ' || COALESCE(v_order_number, NEW.order_id::text) || E'\n'
    || 'الصنف: ' || NEW.product_name || E'\n'
    || 'الكمية الملغاة: ' || v_quantity_text || E'\n'
    || 'السبب: ' || NEW.reason || E'\n'
    || '----------------';

  -- The fixed template uses the same schema consumed by normal kitchen sends.
  v_template := jsonb_build_object(
    'version', 1,
    'kind', 'kitchen',
    'isAr', true,
    'paperWidthMm', 80,
    'storeName', 'JOHNA''S',
    'storeSubtitle', 'RESTAURANT',
    'title', 'إلغاء المطبخ',
    'subtitle', 'VOID COPY',
    'station', v_station_code,
    'meta', jsonb_build_array(
      jsonb_build_object(
        'label', 'رقم الطلب',
        'value', COALESCE(v_order_number, NEW.order_id::text),
        'emphasis', true
      ),
      jsonb_build_object(
        'label', 'التاريخ',
        'value', to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI')
      ),
      jsonb_build_object(
        'label', 'السبب',
        'value', NEW.reason,
        'emphasis', true
      )
    ),
    'itemsHeading', 'الصنف الملغي',
    'items', jsonb_build_array(
      jsonb_build_object(
        'qty', v_quantity_text,
        'name', NEW.product_name,
        'modifiers', jsonb_build_array()
      )
    ),
    'footerLines', jsonb_build_array('إلغاء / VOID')
  );

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
      'template', v_template,
      'paperWidthMm', 80,
      'copies', 1,
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

NOTIFY pgrst, 'reload schema';
