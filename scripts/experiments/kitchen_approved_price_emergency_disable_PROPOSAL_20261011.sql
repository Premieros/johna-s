-- DISABLE ONLY price capture, reversible no-data-mutating emergency fallback.
-- Review and approve independently before production execution; use an atomic
-- migration transaction and 2s lock timeout, never change kitchen FIFO triggers.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $check$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_capture_kitchen_ingredient_prices'
     AND tgfoid='public._capture_kitchen_ingredient_prices()'::regprocedure
     AND tgenabled IN ('O','D')
 ) THEN RAISE EXCEPTION 'PRICE_TRIGGER_MISSING_OR_UNEXPECTED'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_sync_sale_source_order_from_kitchen_event'
     AND tgenabled='O'
 ) THEN RAISE EXCEPTION 'SOURCE_ORDER_SYNC_MUST_REMAIN_ON'; END IF;
END;
$check$;
ALTER TABLE public.order_kitchen_inventory_events
  DISABLE TRIGGER trg_capture_kitchen_ingredient_prices;
-- Historical snapshots stay immutable. No order/warehouse/FIFO/journal writes.
