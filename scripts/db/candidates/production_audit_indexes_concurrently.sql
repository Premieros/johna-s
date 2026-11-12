-- Production rollout preflight ONLY after explicit approval.
-- Execute each CREATE INDEX as its own top-level command, outside a transaction.
-- Build before applying the guarded migration, so production writes are not held
-- by a normal index build. Stop on failure/invalid index; do not auto-drop/retry.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_ledger_priced_receipt_recent
 ON public.inventory_ledger(raw_material_id,branch_id,warehouse_id,created_at DESC NULLS LAST,id DESC)
 INCLUDE(unit_cost)
 WHERE quantity>0 AND COALESCE(unit_cost,0)>0
 AND (COALESCE(entry_type,'')='purchase' OR COALESCE(reference_type,'') IN ('purchase','purchase_receipt'));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_batches_real_price_recent
 ON public.raw_material_batches(raw_material_id,branch_id,warehouse_id,created_at DESC NULLS LAST,id DESC)
 INCLUDE(unit_cost)
 WHERE COALESCE(unit_cost,0)>0 AND COALESCE(source_type,'') NOT LIKE '%_oversold';

