-- Candidate ONLY; do not run on production without isolated plan/lock/write benchmarks.
-- Baseline 2026-10-10: inventory_ledger 35,012 rows; 17,518 match this predicate.
-- Current EXPLAIN with an empty synthetic UUID chose warehouse-only index + sort.
-- Use CONCURRENTLY outside any surrounding transaction if subsequently approved.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_ledger_recent_real_fifo_issue
ON public.inventory_ledger
  (raw_material_id, branch_id, warehouse_id, created_at DESC NULLS LAST, id DESC)
INCLUDE (unit_cost)
WHERE quantity < 0
  AND COALESCE(unit_cost, 0) > 0
  AND COALESCE(batch_number, '') NOT LIKE 'OV-%';

-- Alternative proposals must compare additional ledger write amplification against
-- real raw/branch/warehouse key plans. No function, FIFO priority or debt change.
