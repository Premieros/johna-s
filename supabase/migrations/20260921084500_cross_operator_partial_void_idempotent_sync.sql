BEGIN;

-- Cross-operator partial sent-item Void hardening.
--
-- cancel_sent_order_item_exact already aligns order_kitchen_sends.sent_quantity
-- before inserting order_kitchen_voids. The AFTER INSERT sync trigger must not
-- issue a second UPDATE when the send snapshot is already correct, because that
-- no-op mutation still traverses ownership guards and can raise
-- ORDER_OPERATOR_REQUIRED for another operator's order.
--
-- Keep the trigger for legacy/audit insert paths, but only mutate when the
-- stored send quantity actually differs from the authoritative order-item qty.

CREATE OR REPLACE FUNCTION public.sync_kitchen_sent_quantity_after_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_current_quantity numeric(14,4);
  v_target_quantity numeric(14,4);
BEGIN
  IF NEW.order_item_id IS NOT NULL THEN
    SELECT oi.quantity
    INTO v_current_quantity
    FROM public.order_items oi
    WHERE oi.id = NEW.order_item_id;

    v_target_quantity := GREATEST(COALESCE(v_current_quantity, 0), 0);

    UPDATE public.order_kitchen_sends
    SET sent_quantity = v_target_quantity,
        sent_at = now(),
        sent_by = COALESCE(NEW.voided_by, sent_by)
    WHERE order_item_id = NEW.order_item_id
      AND sent_quantity IS DISTINCT FROM v_target_quantity;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_kitchen_sent_quantity_after_void()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_kitchen_sent_quantity_after_void()
  TO service_role, postgres;

COMMENT ON FUNCTION public.sync_kitchen_sent_quantity_after_void() IS
  'Idempotently aligns the kitchen send snapshot after a sent-item void and skips no-op updates so controlled cross-operator partial voids do not trip ownership guards.';

NOTIFY pgrst, 'reload schema';

COMMIT;
