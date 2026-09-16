-- Fix raw-material recipe costing when the current batch valuation is missing/zero.
--
-- Source priority is intentionally conservative:
--   1) current positive raw-material batches (weighted average),
--   2) persisted raw_material_inventory.avg_cost,
--   3) the newest trusted historical price from an APPLIED stock count or
--      COMPLETED purchase for the same branch/raw material,
--   4) raw_materials.default_cost.
--
-- This migration does not rewrite historical purchases, stock counts, batches,
-- or inventory balances. It only fixes the cost resolver used by recipe/cost-center
-- calculations so existing authoritative prices are no longer ignored.

CREATE OR REPLACE FUNCTION public._raw_wavg_cost(
  p_raw_material_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cost numeric;
BEGIN
  -- 1) Current on-hand batches remain the primary valuation source.
  SELECT round(
           SUM(b.quantity * COALESCE(b.unit_cost, 0))
           / NULLIF(SUM(b.quantity), 0),
           2
         )
    INTO v_cost
    FROM public.raw_material_batches b
   WHERE b.raw_material_id = p_raw_material_id
     AND b.quantity > 0
     AND (p_branch_id IS NULL OR b.branch_id = p_branch_id);

  IF COALESCE(v_cost, 0) > 0 THEN
    RETURN v_cost;
  END IF;

  -- 2) Keep an already-calculated inventory average if one exists.
  SELECT round(rmi.avg_cost, 2)
    INTO v_cost
    FROM public.raw_material_inventory rmi
   WHERE rmi.raw_material_id = p_raw_material_id
     AND (p_branch_id IS NULL OR rmi.branch_id = p_branch_id)
     AND COALESCE(rmi.avg_cost, 0) > 0
   ORDER BY rmi.updated_at DESC NULLS LAST, rmi.id DESC
   LIMIT 1;

  IF COALESCE(v_cost, 0) > 0 THEN
    RETURN v_cost;
  END IF;

  -- 3) If live valuation is unavailable, use the newest authoritative price
  --    already recorded by an applied count or completed purchase.
  SELECT round(src.unit_cost, 2)
    INTO v_cost
    FROM (
      SELECT
        sci.unit_cost,
        COALESCE(sc.applied_at, sc.approved_at, sc.created_at) AS priced_at,
        1 AS source_rank
      FROM public.stock_count_items sci
      JOIN public.stock_counts sc ON sc.id = sci.stock_count_id
      WHERE sci.raw_material_id = p_raw_material_id
        AND sc.status = 'applied'
        AND COALESCE(sci.unit_cost, 0) > 0
        AND (p_branch_id IS NULL OR sc.branch_id = p_branch_id)

      UNION ALL

      SELECT
        pi.unit_cost,
        COALESCE(p.approved_at, pi.created_at, p.created_at) AS priced_at,
        2 AS source_rank
      FROM public.purchase_items pi
      JOIN public.purchases p ON p.id = pi.purchase_id
      WHERE pi.raw_material_id = p_raw_material_id
        AND p.status = 'completed'
        AND COALESCE(pi.unit_cost, 0) > 0
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    ) src
   ORDER BY src.priced_at DESC NULLS LAST, src.source_rank
   LIMIT 1;

  IF COALESCE(v_cost, 0) > 0 THEN
    RETURN v_cost;
  END IF;

  -- 4) Last safe fallback: the catalog default cost.
  SELECT round(COALESCE(rm.default_cost, 0), 2)
    INTO v_cost
    FROM public.raw_materials rm
   WHERE rm.id = p_raw_material_id
     AND (p_branch_id IS NULL OR rm.branch_id = p_branch_id)
   LIMIT 1;

  RETURN COALESCE(v_cost, 0);
END;
$function$;

COMMENT ON FUNCTION public._raw_wavg_cost(uuid, uuid) IS
  'Returns raw-material cost for recipe/cost-center calculations: live batch WAVG, inventory avg, newest applied stock-count/completed-purchase price, then default cost.';
