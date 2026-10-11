-- PENDING FIX #489: bounded read indexes for open-check print guard and
-- historical-cost lookup on oversold raw material batches.
-- Forward-only, no data rewrites or function/security changes.
-- IMPORTANT: Production deployment requires separate owner approval and quiet
-- window after exact-head CI. No direct production DDL in this PR.
--
-- Keep the original branches/warehouses and all FIFO/accounting authority.
-- These indexes match exact existing WHERE clauses and ORDER BY expressions.
-- Partial predicates limit ledger write overhead compared with all-row indexes.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- get_open_order_print_state + enqueue_cloud_open_order_print:
--   cp.branch_id = ? AND cp.kind='receipt'
--   AND cp.idempotency_key LIKE 'open-check:<order uuid>:%'
-- C text_pattern_ops enables a prefix range search despite non-C collation.
-- The unique (branch_id,idempotency_key) print-once constraint is untouched.
CREATE INDEX IF NOT EXISTS idx_cloud_print_receipt_open_check_lookup
  ON public.cloud_print_jobs (branch_id, idempotency_key text_pattern_ops)
  WHERE kind = 'receipt';

-- _raw_last_known_fifo_cost: most recent *actual priced* FIFO issue;
-- valuation-only lookup on the same raw material + branch + warehouse.
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_fifo_known_cost_recent
  ON public.inventory_ledger
    (raw_material_id, branch_id, warehouse_id,
     created_at DESC NULLS LAST, id DESC)
  INCLUDE (unit_cost)
  WHERE quantity < 0
    AND COALESCE(unit_cost, 0) > 0
    AND COALESCE(batch_number, '') NOT LIKE 'OV-%';

-- The second lookup reads normalized positive-cost receipt history.
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_receipt_known_cost_recent
  ON public.inventory_ledger
    (raw_material_id, branch_id, warehouse_id,
     created_at DESC NULLS LAST, id DESC)
  INCLUDE (unit_cost)
  WHERE quantity > 0
    AND COALESCE(unit_cost, 0) > 0
    AND (
      COALESCE(entry_type, '') = 'purchase'
      OR COALESCE(reference_type, '') IN ('purchase', 'purchase_receipt')
    );

-- Third candidate in the same resolver: latest real priced batch.
-- Excludes debt-generated synthetic *_oversold rows.
CREATE INDEX IF NOT EXISTS idx_raw_batches_known_cost_recent
  ON public.raw_material_batches
    (raw_material_id, branch_id, warehouse_id,
     created_at DESC NULLS LAST, id DESC)
  INCLUDE (unit_cost)
  WHERE COALESCE(unit_cost, 0) > 0
    AND COALESCE(source_type, '') NOT LIKE '%_oversold';

-- No DML, function bodies, grants, constraints, or trigger states are changed.
