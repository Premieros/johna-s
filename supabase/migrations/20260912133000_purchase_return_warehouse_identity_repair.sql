-- Repair purchase-return warehouse identity without weakening branch isolation.
--
-- Production may contain completed legacy purchases whose stored warehouse_id
-- points at another branch, while the branch now has one authoritative active
-- warehouse. Such rows cannot be reversed safely by update_purchase_invoice.
-- Repair only the unambiguous single-active-warehouse case; never guess when a
-- branch has multiple active warehouses.

WITH single_active_warehouse AS (
  SELECT branch_id, MIN(id::text)::uuid AS warehouse_id
  FROM public.warehouses
  WHERE is_active = true
  GROUP BY branch_id
  HAVING COUNT(*) = 1
)
UPDATE public.purchases p
SET warehouse_id = saw.warehouse_id
FROM single_active_warehouse saw
WHERE p.branch_id = saw.branch_id
  AND (
    p.warehouse_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.warehouses current_w
      WHERE current_w.id = p.warehouse_id
        AND current_w.branch_id = p.branch_id
        AND current_w.is_active = true
    )
  );

-- Reinstall the locked legacy raw FIFO bridge as an append-only migration.
-- Earlier Production applied the original migration before its later source
-- correction, leaving purchase_return absent from the live bridge.
CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'production',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $bridge$
DECLARE
  v_warehouse_id uuid;
  v_qty numeric := p_qty;
  v_purchase_unit text;
  v_purchase_cost numeric;
  v_norm jsonb;
  v_candidate_count integer;
BEGIN
  IF p_reference_type = 'warehouse_transfer' AND p_reference_id IS NOT NULL THEN
    SELECT wt.from_warehouse_id INTO v_warehouse_id
    FROM public.warehouse_transfers wt
    WHERE wt.id = p_reference_id AND wt.branch_id = p_branch_id;

  ELSIF p_reference_type = 'sale' AND p_reference_id IS NOT NULL THEN
    SELECT s.warehouse_id INTO v_warehouse_id
    FROM public.sales s
    WHERE s.id = p_reference_id AND s.branch_id = p_branch_id;

  ELSIF p_reference_type = 'production' AND p_reference_id IS NOT NULL THEN
    SELECT iup.warehouse_id INTO v_warehouse_id
    FROM public.inventory_unit_productions iup
    WHERE iup.id = p_reference_id AND iup.branch_id = p_branch_id;

  ELSIF p_reference_type = 'purchase_return' AND p_reference_id IS NOT NULL THEN
    -- First prefer a valid warehouse stored on the purchase header.
    SELECT p.warehouse_id INTO v_warehouse_id
    FROM public.purchases p
    JOIN public.warehouses w
      ON w.id = p.warehouse_id
     AND w.branch_id = p.branch_id
     AND w.is_active = true
    WHERE p.id = p_reference_id
      AND p.branch_id = p_branch_id;

    -- If the legacy header is missing/invalid, derive from the actual raw batches
    -- posted by this purchase only when exactly one warehouse is represented.
    IF v_warehouse_id IS NULL THEN
      SELECT COUNT(DISTINCT b.warehouse_id), MIN(b.warehouse_id::text)::uuid
      INTO v_candidate_count, v_warehouse_id
      FROM public.raw_material_batches b
      WHERE b.source_id = p_reference_id
        AND b.branch_id = p_branch_id
        AND b.raw_material_id = p_raw_material_id
        AND b.warehouse_id IS NOT NULL;

      IF v_candidate_count <> 1 THEN
        v_warehouse_id := NULL;
      END IF;
    END IF;

    -- Final safe fallback: exactly one active warehouse in the branch.
    IF v_warehouse_id IS NULL THEN
      SELECT COUNT(*), MIN(w.id::text)::uuid
      INTO v_candidate_count, v_warehouse_id
      FROM public.warehouses w
      WHERE w.branch_id = p_branch_id
        AND w.is_active = true;

      IF v_candidate_count <> 1 THEN
        v_warehouse_id := NULL;
      END IF;
    END IF;

    -- purchase_items retain invoice UOM while raw FIFO uses base UOM.
    SELECT pi.unit_name, pi.unit_cost
    INTO v_purchase_unit, v_purchase_cost
    FROM public.purchase_items pi
    WHERE pi.purchase_id = p_reference_id
      AND pi.raw_material_id = p_raw_material_id
    ORDER BY pi.created_at DESC NULLS LAST, pi.id DESC
    LIMIT 1;

    IF FOUND THEN
      v_norm := public._normalize_raw_purchase_uom(
        p_raw_material_id,
        p_qty,
        COALESCE(v_purchase_cost, 0),
        v_purchase_unit
      );
      IF COALESCE((v_norm->>'success')::boolean, false) IS NOT TRUE THEN
        RETURN v_norm;
      END IF;
      v_qty := (v_norm->>'stock_quantity')::numeric;
    END IF;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'WAREHOUSE_REQUIRED',
      'shortage', p_qty
    );
  END IF;

  -- The explicit warehouse-aware FIFO remains authoritative and validates the
  -- branch/warehouse pair. No cross-branch or cross-warehouse fallback occurs.
  RETURN public._raw_remove_fifo(
    p_raw_material_id,
    p_branch_id,
    v_warehouse_id,
    v_qty,
    p_entry_type,
    p_reference_type,
    p_reference_id,
    p_reference_number,
    p_created_by
  );
END;
$bridge$;

REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,numeric,text,text,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(uuid,uuid,numeric,text,text,uuid,text,uuid)
  TO service_role, postgres;
