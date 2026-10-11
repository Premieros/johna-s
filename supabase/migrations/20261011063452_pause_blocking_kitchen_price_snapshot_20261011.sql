-- EMERGENCY PROPOSAL ONLY: DO NOT APPLY TO PRODUCTION WITHOUT SEPARATE
-- EXPLICIT APPROVAL, EXACT-HEAD CI, AND A QUIET-WINDOW LOCK CHECK.
--
-- Incident: PR #482 introduced a BEFORE INSERT trigger that performs a
-- get_raw_material_current_prices() read once for EACH kitchen inventory event.
-- Production PostgreSQL logs show send_to_kitchen statement-timeout failures
-- inside that trigger. A timeout rolls back the whole kitchen send and prevents
-- the application from reaching station print enqueue.
--
-- Temporary mitigation: pause ONLY the operational report price-snapshot
-- trigger. This preserves send-to-kitchen inventory/FIFO, warehouse pinning,
-- payments, journals, KDS dispatch, and cloud-print job generation.
--
-- Consequence: NEW event snapshots after this mitigation will not have
-- approved dispatch unit_cost/extended_cost fields. Reports MUST treat these
-- costs as unknown, not zero, and must NOT reconstruct past prices later.
-- Existing priced snapshots remain unchanged. Restore the trigger ONLY after
-- replacing its hot-path lookup with a verified bounded-cost design.
--
-- Reversible (AFTER optimized implementation is deployed and verified):
--   ALTER TABLE public.order_kitchen_inventory_events
--     ENABLE TRIGGER trg_capture_kitchen_ingredient_prices;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $hotfix_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.order_kitchen_inventory_events'::regclass
      AND t.tgname = 'trg_capture_kitchen_ingredient_prices'
      AND t.tgfoid = 'public._capture_kitchen_ingredient_prices()'::regprocedure
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'KITCHEN_PRICE_SNAPSHOT_TRIGGER_NOT_FOUND';
  END IF;
END;
$hotfix_guard$;

ALTER TABLE public.order_kitchen_inventory_events
  DISABLE TRIGGER trg_capture_kitchen_ingredient_prices;
