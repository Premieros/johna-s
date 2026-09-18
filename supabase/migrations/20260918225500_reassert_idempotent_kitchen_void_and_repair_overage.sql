-- Reassert the idempotent kitchen-void send snapshot and repair any live
-- open-order inventory-event overage created by the legacy double-decrement
-- trigger.
--
-- Root cause:
-- cancel_sent_order_item_exact already decrements order_kitchen_sends before
-- inserting order_kitchen_voids. The legacy AFTER INSERT trigger also
-- subtracted NEW.quantity, making the next send look like a fresh delta. That
-- duplicate delta could deduct inventory twice and leave pending kitchen
-- inventory events greater than the current order-item quantity.
--
-- The canonical behavior is idempotent: after the void audit row is inserted,
-- the send snapshot equals the current order-item quantity (or zero if removed).

CREATE OR REPLACE FUNCTION public.sync_kitchen_sent_quantity_after_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_current_quantity numeric(14,4);
BEGIN
  IF NEW.order_item_id IS NOT NULL THEN
    SELECT oi.quantity
    INTO v_current_quantity
    FROM public.order_items oi
    WHERE oi.id = NEW.order_item_id;

    UPDATE public.order_kitchen_sends
    SET sent_quantity = GREATEST(COALESCE(v_current_quantity, 0), 0),
        sent_at = now(),
        sent_by = COALESCE(NEW.voided_by, sent_by)
    WHERE order_item_id = NEW.order_item_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_kitchen_sent_quantity_after_void()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_kitchen_sent_quantity_after_void()
  TO service_role, postgres;

COMMENT ON FUNCTION public.sync_kitchen_sent_quantity_after_void() IS
  'Idempotently aligns the kitchen send snapshot with the current order-item quantity after an approved sent-item void. Never subtracts the void twice.';

-- Repair only live open/held lines where unsettled kitchen inventory events are
-- provably greater than the current order-item quantity. The excess represents
-- duplicate send-side inventory consumption; restore exactly that excess using
-- the existing authoritative inventory restoration helper.
DO $repair$
DECLARE
  v_row record;
  v_excess numeric(14,6);
  v_result jsonb;
BEGIN
  FOR v_row IN
    SELECT
      o.id AS order_id,
      oi.id AS order_item_id,
      oi.quantity::numeric(14,6) AS current_quantity,
      COALESCE(sum(
        GREATEST(e.sent_quantity - e.voided_quantity, 0)
      ) FILTER (WHERE e.settled_sale_id IS NULL), 0)::numeric(14,6) AS pending_quantity
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.order_kitchen_inventory_events e
      ON e.order_id = o.id
     AND e.order_item_id = oi.id
    WHERE o.status IN ('open','held')
    GROUP BY o.id, oi.id, oi.quantity
    HAVING COALESCE(sum(
      GREATEST(e.sent_quantity - e.voided_quantity, 0)
    ) FILTER (WHERE e.settled_sale_id IS NULL), 0) > oi.quantity + 0.000001
    ORDER BY o.id, oi.id
  LOOP
    v_excess := v_row.pending_quantity - v_row.current_quantity;

    v_result := public._restore_kitchen_inventory_for_void(
      v_row.order_id,
      v_row.order_item_id,
      v_excess
    );

    IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE
       OR abs(COALESCE((v_result->>'restored_sent_quantity')::numeric, 0) - v_excess) > 0.000001 THEN
      RAISE EXCEPTION
        'KITCHEN_EVENT_OVERAGE_REPAIR_FAILED order=% item=% excess=% result=%',
        v_row.order_id, v_row.order_item_id, v_excess, v_result;
    END IF;

    UPDATE public.order_kitchen_sends
    SET sent_quantity = GREATEST(v_row.current_quantity, 0),
        sent_at = now()
    WHERE order_item_id = v_row.order_item_id;
  END LOOP;
END;
$repair$;

NOTIFY pgrst, 'reload schema';
