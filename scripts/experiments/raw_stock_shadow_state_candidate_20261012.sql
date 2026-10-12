-- STAGING CANDIDATE / OWNER-APPROVED DESIGN ONLY (#489).
-- Never execute in Production and never move into supabase/migrations without
-- an independently reviewed rollout, separate explicit owner authorization,
-- exact-head CI, measured write overhead, and a low-traffic window.
-- One-time bootstrap below takes SHARE ROW EXCLUSIVE on raw_material_batches
-- to avoid a missed/duplicated delta between the backfill and the trigger.
-- STAGE A IS SHADOW ONLY: no app/RPC/view switches, no historical mutation.
--
-- For every (material, branch, warehouse) and (material, branch) keep:
--   quantity         = SUM(quantity) over ALL batches, including negative debt
--   stock_value      = SUM(quantity * unit_cost) over ALL batches
--   positive_qty     = SUM(GREATEST(quantity, 0))
--   positive_value   = SUM(GREATEST(quantity, 0) * unit_cost)
-- stock_value is NOT purchase price, sales COGS, or latest FIFO cost.
-- These source-of-truth aggregates are designed to replace *repeated SUMs*,
-- never to replace ordered FIFO batch/debt settlement, journal or snapshots.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';

-- Must be held through bootstrap, parity check, and trigger creation.
LOCK TABLE public.raw_material_batches IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE private.raw_stock_branch_shadow (
  raw_material_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  stock_value numeric NOT NULL DEFAULT 0,
  positive_qty numeric NOT NULL DEFAULT 0,
  positive_value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_material_id, branch_id)
);

CREATE TABLE private.raw_stock_warehouse_shadow (
  raw_material_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  stock_value numeric NOT NULL DEFAULT 0,
  positive_qty numeric NOT NULL DEFAULT 0,
  positive_value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_material_id, branch_id, warehouse_id)
);

-- No direct client writes or reads to shadow storage.
ALTER TABLE private.raw_stock_branch_shadow ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.raw_stock_warehouse_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_stock_branch_shadow FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.raw_stock_warehouse_shadow FROM PUBLIC, anon, authenticated;

-- The stock batches remain the only authority. Only batch writes update state.
-- The warehouse grouping skips legacy NULL warehouse, but the branch grouping
-- includes it (same as the existing _raw_add/_raw_remove_fifo branch sums).
INSERT INTO private.raw_stock_branch_shadow
  (raw_material_id, branch_id, quantity, stock_value, positive_qty, positive_value)
SELECT raw_material_id, branch_id,
       COALESCE(SUM(quantity), 0),
       COALESCE(SUM(quantity * COALESCE(unit_cost, 0)), 0),
       COALESCE(SUM(GREATEST(quantity, 0)), 0),
       COALESCE(SUM(GREATEST(quantity, 0) * COALESCE(unit_cost, 0)), 0)
FROM public.raw_material_batches
GROUP BY raw_material_id, branch_id;

INSERT INTO private.raw_stock_warehouse_shadow
  (raw_material_id, branch_id, warehouse_id, quantity, stock_value, positive_qty, positive_value)
SELECT raw_material_id, branch_id, warehouse_id,
       COALESCE(SUM(quantity), 0),
       COALESCE(SUM(quantity * COALESCE(unit_cost, 0)), 0),
       COALESCE(SUM(GREATEST(quantity, 0)), 0),
       COALESCE(SUM(GREATEST(quantity, 0) * COALESCE(unit_cost, 0)), 0)
FROM public.raw_material_batches
WHERE warehouse_id IS NOT NULL
GROUP BY raw_material_id, branch_id, warehouse_id;

-- Internal, non-API helper. Both upserts are part of the caller's transaction:
-- a failed kitchen send, purchase, count, transfer or reversal also rolls
-- back every shadow delta. No independent queue or asynchronous state.
CREATE FUNCTION private.apply_raw_stock_shadow_delta(
  p_material_id uuid, p_branch_id uuid, p_warehouse_id uuid,
  p_qty numeric, p_value numeric, p_positive_qty numeric, p_positive_value numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $delta$
BEGIN
  IF p_material_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'RAW_STOCK_SHADOW_MISSING_SCOPE';
  END IF;

  INSERT INTO private.raw_stock_branch_shadow
    (raw_material_id, branch_id, quantity, stock_value, positive_qty, positive_value)
  VALUES (p_material_id, p_branch_id, p_qty, p_value, p_positive_qty, p_positive_value)
  ON CONFLICT (raw_material_id, branch_id) DO UPDATE
  SET quantity = private.raw_stock_branch_shadow.quantity + EXCLUDED.quantity,
      stock_value = private.raw_stock_branch_shadow.stock_value + EXCLUDED.stock_value,
      positive_qty = private.raw_stock_branch_shadow.positive_qty + EXCLUDED.positive_qty,
      positive_value = private.raw_stock_branch_shadow.positive_value + EXCLUDED.positive_value,
      updated_at = now();

  IF p_warehouse_id IS NOT NULL THEN
    INSERT INTO private.raw_stock_warehouse_shadow
      (raw_material_id, branch_id, warehouse_id, quantity, stock_value, positive_qty, positive_value)
    VALUES (p_material_id, p_branch_id, p_warehouse_id, p_qty, p_value, p_positive_qty, p_positive_value)
    ON CONFLICT (raw_material_id, branch_id, warehouse_id) DO UPDATE
    SET quantity = private.raw_stock_warehouse_shadow.quantity + EXCLUDED.quantity,
        stock_value = private.raw_stock_warehouse_shadow.stock_value + EXCLUDED.stock_value,
        positive_qty = private.raw_stock_warehouse_shadow.positive_qty + EXCLUDED.positive_qty,
        positive_value = private.raw_stock_warehouse_shadow.positive_value + EXCLUDED.positive_value,
        updated_at = now();
  END IF;
END;
$delta$;

-- AFTER trigger sees the final unit_cost (including the existing oversold
-- BEFORE trigger), catches all present/future INSERT/UPDATE/DELETE writers,
-- and includes quantity, valuation, or warehouse-scope corrections.
CREATE FUNCTION private.sync_raw_stock_shadow_from_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $trigger$
DECLARE
  v_same_scope boolean;
  v_qty numeric;
  v_value numeric;
  v_pos_qty numeric;
  v_pos_value numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.apply_raw_stock_shadow_delta(
      NEW.raw_material_id, NEW.branch_id, NEW.warehouse_id,
      NEW.quantity, NEW.quantity * NEW.unit_cost,
      GREATEST(NEW.quantity, 0), GREATEST(NEW.quantity, 0) * NEW.unit_cost
    );
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.apply_raw_stock_shadow_delta(
      OLD.raw_material_id, OLD.branch_id, OLD.warehouse_id,
      -OLD.quantity, -(OLD.quantity * OLD.unit_cost),
      -GREATEST(OLD.quantity, 0), -(GREATEST(OLD.quantity, 0) * OLD.unit_cost)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_same_scope :=
       NEW.raw_material_id IS NOT DISTINCT FROM OLD.raw_material_id
       AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
       AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id;
    IF v_same_scope THEN
      v_qty := NEW.quantity - OLD.quantity;
      v_value := NEW.quantity * NEW.unit_cost - OLD.quantity * OLD.unit_cost;
      v_pos_qty := GREATEST(NEW.quantity, 0) - GREATEST(OLD.quantity, 0);
      v_pos_value := GREATEST(NEW.quantity, 0) * NEW.unit_cost
                     - GREATEST(OLD.quantity, 0) * OLD.unit_cost;
      IF v_qty <> 0 OR v_value <> 0 OR v_pos_qty <> 0 OR v_pos_value <> 0 THEN
        PERFORM private.apply_raw_stock_shadow_delta(
          NEW.raw_material_id, NEW.branch_id, NEW.warehouse_id,
          v_qty, v_value, v_pos_qty, v_pos_value
        );
      END IF;
    ELSE
      -- Cross-key changes are intentionally observable in shadow mode.
      -- Must be stress-tested for deterministic lock ordering before cutover.
      PERFORM private.apply_raw_stock_shadow_delta(
        OLD.raw_material_id, OLD.branch_id, OLD.warehouse_id,
        -OLD.quantity, -(OLD.quantity * OLD.unit_cost),
        -GREATEST(OLD.quantity, 0), -(GREATEST(OLD.quantity, 0) * OLD.unit_cost)
      );
      PERFORM private.apply_raw_stock_shadow_delta(
        NEW.raw_material_id, NEW.branch_id, NEW.warehouse_id,
        NEW.quantity, NEW.quantity * NEW.unit_cost,
        GREATEST(NEW.quantity, 0), GREATEST(NEW.quantity, 0) * NEW.unit_cost
      );
    END IF;
  END IF;
  RETURN NULL; -- AFTER row trigger
END;
$trigger$;

REVOKE ALL ON FUNCTION private.apply_raw_stock_shadow_delta(uuid,uuid,uuid,numeric,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_raw_stock_shadow_from_batch() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_raw_stock_shadow_batch_delta
AFTER INSERT OR UPDATE OR DELETE ON public.raw_material_batches
FOR EACH ROW
EXECUTE FUNCTION private.sync_raw_stock_shadow_from_batch();

-- A TRUNCATE is not a DELETE and does not fire row triggers. An explicit guard
-- prevents silently stale shadow state if an operator attempts a bulk purge.
CREATE FUNCTION private.reject_raw_stock_shadow_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $guard$
BEGIN
  RAISE EXCEPTION 'RAW_STOCK_SHADOW_TRUNCATE_REQUIRES_SEPARATE_RECONCILIATION';
END;
$guard$;
REVOKE ALL ON FUNCTION private.reject_raw_stock_shadow_truncate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_raw_stock_shadow_reject_truncate
BEFORE TRUNCATE ON public.raw_material_batches
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_raw_stock_shadow_truncate();

-- Mandatory cutover gate: compare all active group keys and all aggregate
-- dimensions. Extra zero rows from later key deletion are legitimate.
DO $audit$
BEGIN
  IF EXISTS (
    WITH actual AS (
      SELECT raw_material_id, branch_id,
        SUM(quantity) quantity,
        SUM(quantity * COALESCE(unit_cost,0)) stock_value,
        SUM(GREATEST(quantity,0)) positive_qty,
        SUM(GREATEST(quantity,0) * COALESCE(unit_cost,0)) positive_value
      FROM public.raw_material_batches GROUP BY 1,2
    )
    SELECT 1 FROM actual a
    FULL JOIN private.raw_stock_branch_shadow s
      USING(raw_material_id,branch_id)
    WHERE COALESCE(a.quantity,0) <> COALESCE(s.quantity,0)
       OR COALESCE(a.stock_value,0) <> COALESCE(s.stock_value,0)
       OR COALESCE(a.positive_qty,0) <> COALESCE(s.positive_qty,0)
       OR COALESCE(a.positive_value,0) <> COALESCE(s.positive_value,0)
  ) OR EXISTS (
    WITH actual AS (
      SELECT raw_material_id, branch_id, warehouse_id,
        SUM(quantity) quantity,
        SUM(quantity * COALESCE(unit_cost,0)) stock_value,
        SUM(GREATEST(quantity,0)) positive_qty,
        SUM(GREATEST(quantity,0) * COALESCE(unit_cost,0)) positive_value
      FROM public.raw_material_batches
      WHERE warehouse_id IS NOT NULL GROUP BY 1,2,3
    )
    SELECT 1 FROM actual a
    FULL JOIN private.raw_stock_warehouse_shadow s
      USING(raw_material_id,branch_id,warehouse_id)
    WHERE COALESCE(a.quantity,0) <> COALESCE(s.quantity,0)
       OR COALESCE(a.stock_value,0) <> COALESCE(s.stock_value,0)
       OR COALESCE(a.positive_qty,0) <> COALESCE(s.positive_qty,0)
       OR COALESCE(a.positive_value,0) <> COALESCE(s.positive_value,0)
  ) THEN
    RAISE EXCEPTION 'RAW_STOCK_SHADOW_BOOTSTRAP_PARITY_FAILED';
  END IF;
END;
$audit$;

-- This COMMIT is for a DISPOSABLE staging transaction ONLY.
-- The file MUST remain outside canonical migrations until independently approved.
COMMIT;
