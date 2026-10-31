-- APPROVED RAW COST ENGINE / storage-minimal SCHEMA CANDIDATE.
-- UNWIRED; ISOLATED DEVELOPMENT ONLY. Do not apply to production or
-- put this file under supabase/migrations until the end-to-end writer,
-- accounting, rollback, compatibility and tenancy gates are complete.
-- This proposal reuses existing inventory_ledger and raw_material_batches
-- rather than generating a new debt/price row per movement.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';

-- NULL means untouched legacy accounting and allows an online cutover.
-- Cost of a new raw movement can later be frozen with one immutable
-- source-price reference and no second debt/snapshot record.
ALTER TABLE public.inventory_ledger
  ADD COLUMN IF NOT EXISTS approved_cost_basis text,
  ADD COLUMN IF NOT EXISTS approved_price_source text,
  ADD COLUMN IF NOT EXISTS approved_price_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_price_ref text,
  ADD COLUMN IF NOT EXISTS approved_cost_recorded_at timestamptz;

DO $approved_ledger_check$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.inventory_ledger'::regclass
      AND conname='inventory_ledger_approved_price_invariant'
  ) THEN
    ALTER TABLE public.inventory_ledger ADD CONSTRAINT inventory_ledger_approved_price_invariant
    CHECK (
      approved_cost_basis IS NULL OR (
        approved_cost_basis='approved_last_known'
        AND raw_material_id IS NOT NULL
        AND approved_price_source IN('purchase','pricing','stock_count')
        AND approved_price_at IS NOT NULL
        AND approved_cost_recorded_at IS NOT NULL
        AND approved_price_at<=approved_cost_recorded_at
        AND unit_cost>0
        AND abs(total_cost - quantity*unit_cost)<=0.005
      )
    ) NOT VALID;
  END IF;
END;
$approved_ledger_check$;

-- One aggregate shortage position per branch/warehouse/material; its
-- negative quantity is already counted by the canonical inventory view.
-- Do NOT create one OV-* batch per negative sale after the cutover.
-- A precise amount avoids rounding the accumulated shortage basis.
ALTER TABLE public.raw_material_batches
  ADD COLUMN IF NOT EXISTS approved_shortage_total_cost numeric(20,6);

DO $approved_shortage_check$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.raw_material_batches'::regclass
      AND conname='raw_batches_approved_shortage_position_invariant'
  ) THEN
    ALTER TABLE public.raw_material_batches
    ADD CONSTRAINT raw_batches_approved_shortage_position_invariant
    CHECK (
      source_type<>'approved_shortage_aggregate' OR (
        warehouse_id IS NOT NULL AND quantity<=0
        AND approved_shortage_total_cost IS NOT NULL
        AND approved_shortage_total_cost>=0
        AND (quantity<0 OR approved_shortage_total_cost=0)
      )
    ) NOT VALID;
  END IF;
END;
$approved_shortage_check$;

-- This partial uniqueness uses the existing batch table. For approved
-- shortage positions only, each physical stock coordinate has one row.
-- Existing FIFO lots and OV-* batches are not re-keyed or updated.
CREATE UNIQUE INDEX IF NOT EXISTS raw_batches_one_approved_shortage_position
ON public.raw_material_batches(branch_id,warehouse_id,raw_material_id)
WHERE source_type='approved_shortage_aggregate';

-- No new tables / background queues / public RPCs / privileges.
-- NO canonical writer is redirected by this standalone candidate.
COMMIT;
