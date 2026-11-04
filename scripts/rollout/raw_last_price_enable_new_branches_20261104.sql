-- Runtime activation only, after all branch quantity/source-cost proofs.
-- Canonical migration installs this trigger disabled for safe staged cutover.
BEGIN;
SET LOCAL lock_timeout='250ms';
SET LOCAL statement_timeout='3s';
SELECT set_config('request.jwt.claim.sub','c55567b0-626b-41fa-abe6-4cce65068003',true),set_config('request.jwt.claims','{"sub":"c55567b0-626b-41fa-abe6-4cce65068003","role":"authenticated"}',true),set_config('app.user_id','c55567b0-626b-41fa-abe6-4cce65068003',true);
LOCK TABLE public.branches IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $enable$ BEGIN
 IF auth.uid() IS NULL OR NOT public.can_permission('inventory.count.apply') THEN RAISE EXCEPTION 'CUTOVER_NOT_ALLOWED'; END IF;
 IF EXISTS(SELECT 1 FROM public.branches b WHERE NOT EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates a WHERE a.branch_id=b.id AND a.warehouse_id IS NULL AND a.raw_material_id IS NULL))
 OR EXISTS(SELECT 1 FROM public.raw_fifo_debts WHERE settled_quantity<debt_quantity AND approved_converted_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.raw_material_batches WHERE quantity<0 AND source_type<>'approved_shortage_aggregate')
 THEN RAISE EXCEPTION 'GLOBAL_LAST_PRICE_CUTOVER_INCOMPLETE'; END IF;
END $enable$;
ALTER TABLE public.branches ENABLE TRIGGER raw_last_price_new_branch_default;
COMMIT;

