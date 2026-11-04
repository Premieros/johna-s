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
        AND approved_price_source IN('purchase','pricing','stock_count','catalog_zero')
        AND approved_price_at IS NOT NULL
        AND approved_cost_recorded_at IS NOT NULL
        AND approved_price_at<=approved_cost_recorded_at
        AND unit_cost>=0
        AND abs(total_cost - quantity*unit_cost)<=0.005
      )
    ) NOT VALID;
  END IF;
END;
$approved_ledger_check$;

-- Physical lots share one rounded monetary movement. An individual lot may
-- carry the residual cent, while the whole movement still equals round(qty*price,2).
-- Retain the entire existing constraint and change only that rounding bound.
DO $lot_rounding_bound$
DECLARE s text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT s FROM pg_constraint
 WHERE conrelid='public.inventory_ledger'::regclass
  AND conname='inventory_ledger_approved_price_invariant';
 IF (length(s)-length(replace(s,'0.005','')))/length('0.005')<>1 THEN
  RAISE EXCEPTION 'APPROVED_LEDGER_ROUNDING_SOURCE_DRIFT';
 END IF;
 ALTER TABLE public.inventory_ledger DROP CONSTRAINT inventory_ledger_approved_price_invariant;
 EXECUTE 'ALTER TABLE public.inventory_ledger ADD CONSTRAINT inventory_ledger_approved_price_invariant '
  ||replace(s,'0.005','0.01');
END;
$lot_rounding_bound$;

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

-- Keep old obligations as auditable history when explicitly converted. Never
-- fake a purchase receipt by changing their settled quantity.
ALTER TABLE public.raw_fifo_debts
 ADD COLUMN IF NOT EXISTS approved_conversion_batch_id uuid REFERENCES public.raw_material_batches(id),
 ADD COLUMN IF NOT EXISTS approved_converted_at timestamptz;
-- Keep receipt/batch removal from scanning archived obligations.
CREATE INDEX IF NOT EXISTS raw_fifo_debts_approved_conversion_batch
 ON public.raw_fifo_debts(approved_conversion_batch_id)
 WHERE approved_conversion_batch_id IS NOT NULL;

-- One routing marker per coordinate, or one branch-wide default after every
-- old coordinate in that branch is reconciled. No per-sale state table.
CREATE TABLE IF NOT EXISTS private.raw_cost_v2_activated_coordinates (
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
 warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
 raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
 activated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 activation_note text NOT NULL DEFAULT '',
 UNIQUE NULLS NOT DISTINCT(branch_id,warehouse_id,raw_material_id),
 CHECK((warehouse_id IS NULL)=(raw_material_id IS NULL))
);
REVOKE ALL ON private.raw_cost_v2_activated_coordinates FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.raw_last_price_enabled(p_branch uuid,p_warehouse uuid,p_raw uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates a
  WHERE a.branch_id=p_branch AND ((a.warehouse_id IS NULL AND a.raw_material_id IS NULL)
   OR (a.warehouse_id=p_warehouse AND a.raw_material_id=p_raw)));
$$;
REVOKE ALL ON FUNCTION private.raw_last_price_enabled(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- No background queues / public RPCs / new application privileges.
-- NO canonical writer is redirected by this standalone candidate.
COMMIT;

