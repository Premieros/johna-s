-- STAGE B ONLY. PROPOSAL, NOT IN supabase/migrations.
-- DO NOT EXECUTE ON PRODUCTION absent independent owner approval after
-- full parity, role/RLS, P95/plan & kitchen first/resend/void checks in staging.
-- Separate stage from installing the helper, so Stage A never resumes traffic.
-- Must be run in a transaction by the approved migration runner.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $gate$
DECLARE v_body text;
BEGIN
 SELECT pg_get_functiondef('public._capture_kitchen_ingredient_prices()'::regprocedure)
 INTO v_body;
 IF v_body IS NULL OR position('_kitchen_approved_price_candidate' IN v_body)=0 THEN
   RAISE EXCEPTION 'OPTIMIZED_CAPTURE_FUNCTION_NOT_INSTALLED';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_capture_kitchen_ingredient_prices'
     AND tgenabled='D'
     AND tgfoid='public._capture_kitchen_ingredient_prices()'::regprocedure
 ) THEN RAISE EXCEPTION 'CAPTURE_TRIGGER_NOT_DISABLED'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.order_kitchen_inventory_events'::regclass
     AND tgname='trg_sync_sale_source_order_from_kitchen_event'
     AND tgenabled='O'
 ) THEN RAISE EXCEPTION 'SOURCE_ORDER_SYNC_NOT_ENABLED'; END IF;
 IF has_function_privilege('anon',
      'public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)',
      'EXECUTE') OR NOT has_function_privilege('authenticated',
      'public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)',
      'EXECUTE') THEN
   RAISE EXCEPTION 'CANDIDATE_ACL_GUARD_FAILED';
 END IF;
END;
$gate$;

-- PRODUCTION CUTOVER — separately authorized manual stage, NEVER auto-run.
ALTER TABLE public.order_kitchen_inventory_events
  ENABLE TRIGGER trg_capture_kitchen_ingredient_prices;

DO $assert$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE
      tgrelid='public.order_kitchen_inventory_events'::regclass
      AND tgname='trg_capture_kitchen_ingredient_prices'
      AND tgenabled='O')
 THEN RAISE EXCEPTION 'CAPTURE_TRIGGER_ENABLE_FAILED'; END IF;
END;
$assert$;
