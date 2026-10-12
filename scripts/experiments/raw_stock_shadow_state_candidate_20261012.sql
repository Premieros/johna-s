-- STAGING-ONLY CANDIDATE (#489); no Production DDL is authorized.
-- Stage A is SHADOW ONLY; never place under supabase/migrations.
--
-- Goal: reduce total DB workload, NOT transfer expensive reads into writes.
-- One shadow row per (raw material, branch, warehouse); NOT two new counters.
-- Keep existing public.raw_material_inventory as authoritative branch stock.
-- Stage A does not replace any operating view, RPC or FIFO/journal code.
--
-- Four aggregates have exact existing batch semantics:
-- quantity = signed sum including negative oversold debt batches.
-- stock_value = signed sum(quantity*unit_cost) (NOT FIFO sale cost).
-- positive_qty = sum(max(quantity,0)).
-- positive_value = sum(max(quantity,0)*unit_cost).
--
-- At most ONE warehouse-key UPSERT per ordinary row write; metadata-only
-- UPDATE performs ZERO shadow writes. Warehouse/key moves do one old/new pair.
-- Very large receipt settlements may still emit many row UPDATEs; Stage B
-- MUST benchmark total work under that workload, and may be rejected.
-- Run ONLY in an isolated disposable full-schema database.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';

-- Serializes one-time warehouse snapshot with first trigger registration.
-- NOT a production deployment plan; requires separate live lock strategy.
LOCK TABLE public.raw_material_batches IN SHARE ROW EXCLUSIVE MODE;

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

ALTER TABLE private.raw_stock_warehouse_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.raw_stock_warehouse_shadow FROM PUBLIC, anon, authenticated;

INSERT INTO private.raw_stock_warehouse_shadow
  (raw_material_id, branch_id, warehouse_id,
   quantity, stock_value, positive_qty, positive_value)
SELECT raw_material_id, branch_id, warehouse_id,
       COALESCE(SUM(quantity),0),
       COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0),
       COALESCE(SUM(GREATEST(quantity,0)),0),
       COALESCE(SUM(GREATEST(quantity,0)*COALESCE(unit_cost,0)),0)
FROM public.raw_material_batches
WHERE warehouse_id IS NOT NULL
GROUP BY raw_material_id, branch_id, warehouse_id;

-- Internal helper called ONLY from an AFTER batch trigger. Atomic UPSERT
-- under the same transaction as the source batch write. Never expose direct
-- anonymous/client access. NULL warehouse legacy batches contribute to
-- the existing branch balance, but not to a nonexistent warehouse scope.
CREATE FUNCTION private.apply_raw_stock_warehouse_delta(
  p_material_id uuid, p_branch_id uuid, p_warehouse_id uuid,
  p_qty numeric, p_value numeric, p_positive_qty numeric, p_positive_value numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $delta$
BEGIN
  IF p_material_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'RAW_STOCK_SHADOW_MISSING_SCOPE';
  END IF;
  IF p_warehouse_id IS NULL THEN
    RETURN;
  END IF;
  IF p_qty=0 AND p_value=0 AND p_positive_qty=0 AND p_positive_value=0 THEN
    RETURN; -- No added row lock/write when a batch is only renamed.
  END IF;

  INSERT INTO private.raw_stock_warehouse_shadow
    (raw_material_id, branch_id, warehouse_id,
     quantity, stock_value, positive_qty, positive_value)
  VALUES (p_material_id,p_branch_id,p_warehouse_id,
          p_qty,p_value,p_positive_qty,p_positive_value)
  ON CONFLICT (raw_material_id,branch_id,warehouse_id) DO UPDATE
  SET quantity = private.raw_stock_warehouse_shadow.quantity + EXCLUDED.quantity,
      stock_value = private.raw_stock_warehouse_shadow.stock_value + EXCLUDED.stock_value,
      positive_qty = private.raw_stock_warehouse_shadow.positive_qty + EXCLUDED.positive_qty,
      positive_value = private.raw_stock_warehouse_shadow.positive_value + EXCLUDED.positive_value,
      updated_at = now();
END;
$delta$;

-- AFTER runs after pre-existing BEFORE oversold price capture.
-- Quantity, unit_cost and key changes are tracked; metadata-only changes
-- (batch label/source) cause no shadow UPDATE or table bloat.
CREATE FUNCTION private.sync_raw_stock_shadow_from_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $trigger$
DECLARE
  v_same_scope boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.apply_raw_stock_warehouse_delta(
      NEW.raw_material_id,NEW.branch_id,NEW.warehouse_id,
      NEW.quantity,NEW.quantity*NEW.unit_cost,
      GREATEST(NEW.quantity,0),GREATEST(NEW.quantity,0)*NEW.unit_cost
    );
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.apply_raw_stock_warehouse_delta(
      OLD.raw_material_id,OLD.branch_id,OLD.warehouse_id,
      -OLD.quantity,-(OLD.quantity*OLD.unit_cost),
      -GREATEST(OLD.quantity,0),-(GREATEST(OLD.quantity,0)*OLD.unit_cost)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_same_scope :=
      NEW.raw_material_id IS NOT DISTINCT FROM OLD.raw_material_id
      AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
      AND NEW.warehouse_id IS NOT DISTINCT FROM OLD.warehouse_id;
    IF v_same_scope THEN
      PERFORM private.apply_raw_stock_warehouse_delta(
        NEW.raw_material_id, NEW.branch_id, NEW.warehouse_id,
        NEW.quantity - OLD.quantity,
        NEW.quantity*NEW.unit_cost - OLD.quantity*OLD.unit_cost,
        GREATEST(NEW.quantity,0) - GREATEST(OLD.quantity,0),
        GREATEST(NEW.quantity,0)*NEW.unit_cost -
          GREATEST(OLD.quantity,0)*OLD.unit_cost
      );
    ELSE
      -- Scope changes are rarer than ordinary consumption/settlement.
      -- Concurrent cross-key lock ordering remains a mandatory stress gate.
      PERFORM private.apply_raw_stock_warehouse_delta(
        OLD.raw_material_id,OLD.branch_id,OLD.warehouse_id,
        -OLD.quantity,-(OLD.quantity*OLD.unit_cost),
        -GREATEST(OLD.quantity,0),-(GREATEST(OLD.quantity,0)*OLD.unit_cost)
      );
      PERFORM private.apply_raw_stock_warehouse_delta(
        NEW.raw_material_id,NEW.branch_id,NEW.warehouse_id,
        NEW.quantity,NEW.quantity*NEW.unit_cost,
        GREATEST(NEW.quantity,0),GREATEST(NEW.quantity,0)*NEW.unit_cost
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$trigger$;

REVOKE ALL ON FUNCTION private.apply_raw_stock_warehouse_delta(uuid,uuid,uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.sync_raw_stock_shadow_from_batch() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER trg_raw_stock_shadow_batch_delta
AFTER INSERT OR UPDATE OR DELETE ON public.raw_material_batches
FOR EACH ROW EXECUTE FUNCTION private.sync_raw_stock_shadow_from_batch();

-- Catch TRUNCATE: row triggers do not fire for it.
CREATE FUNCTION private.reject_raw_stock_shadow_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $guard$
BEGIN
  RAISE EXCEPTION 'RAW_STOCK_SHADOW_TRUNCATE_REQUIRES_SEPARATE_RECONCILIATION';
END;
$guard$;
REVOKE ALL ON FUNCTION private.reject_raw_stock_shadow_truncate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_raw_stock_shadow_reject_truncate
BEFORE TRUNCATE ON public.raw_material_batches
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_raw_stock_shadow_truncate();

-- No row-level reads are redirected to this experimental cache yet.
-- Bootstrapped values must exactly match the source batches, including
-- price and negative-stock semantics. A failed audit ROLLBACKs all changes.
DO $audit$
BEGIN
  IF EXISTS (
    WITH actual AS (
      SELECT raw_material_id,branch_id,warehouse_id,
        SUM(quantity) quantity,
        SUM(quantity*COALESCE(unit_cost,0)) stock_value,
        SUM(GREATEST(quantity,0)) positive_qty,
        SUM(GREATEST(quantity,0)*COALESCE(unit_cost,0)) positive_value
      FROM public.raw_material_batches
      WHERE warehouse_id IS NOT NULL
      GROUP BY 1,2,3
    )
    SELECT 1 FROM actual a
    FULL JOIN private.raw_stock_warehouse_shadow s
      USING (raw_material_id,branch_id,warehouse_id)
    WHERE COALESCE(a.quantity,0) <> COALESCE(s.quantity,0)
       OR COALESCE(a.stock_value,0) <> COALESCE(s.stock_value,0)
       OR COALESCE(a.positive_qty,0) <> COALESCE(s.positive_qty,0)
       OR COALESCE(a.positive_value,0) <> COALESCE(s.positive_value,0)
  ) THEN
    RAISE EXCEPTION 'RAW_STOCK_SHADOW_BOOTSTRAP_PARITY_FAILED';
  END IF;
END;
$audit$;

-- In disposable staging only; keep out of canonical migrations.
COMMIT;
