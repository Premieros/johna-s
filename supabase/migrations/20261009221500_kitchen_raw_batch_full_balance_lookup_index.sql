-- Targeted performance fix for the authoritative kitchen raw-material FIFO path.
-- Live evidence (2026-10-09): SQLSTATE 57014 at _raw_remove_fifo's
-- SELECT SUM(quantity) ... raw_material_id / branch_id / warehouse_id.
-- Existing three-key index excludes quantity <= 0 and cannot serve the
-- full stock calculation used for negative raw sell-through.
-- DO NOT deploy to production without a fresh full verify and explicit
-- production DDL approval; normal CREATE INDEX may briefly block writes.
-- Does not alter quantities, debt ledger, recipes, triggers, accounting or printing.
CREATE INDEX IF NOT EXISTS idx_raw_batches_branch_warehouse_material_all_qty
  ON public.raw_material_batches (branch_id, warehouse_id, raw_material_id)
  INCLUDE (quantity);
