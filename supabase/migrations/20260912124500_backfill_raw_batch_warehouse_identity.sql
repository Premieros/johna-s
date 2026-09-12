-- Backfill legacy raw-material stock rows that predate warehouse-aware inventory.
-- Safety rule: assign only when the branch has exactly one active warehouse.
-- This restores warehouse-scoped availability without cross-warehouse guessing.

WITH single_active_warehouse AS (
  SELECT branch_id, MIN(id::text)::uuid AS warehouse_id
  FROM public.warehouses
  WHERE is_active = true
  GROUP BY branch_id
  HAVING COUNT(*) = 1
)
UPDATE public.raw_material_batches b
SET warehouse_id = w.warehouse_id
FROM single_active_warehouse w
WHERE b.branch_id = w.branch_id
  AND b.warehouse_id IS NULL;

WITH single_active_warehouse AS (
  SELECT branch_id, MIN(id::text)::uuid AS warehouse_id
  FROM public.warehouses
  WHERE is_active = true
  GROUP BY branch_id
  HAVING COUNT(*) = 1
)
UPDATE public.inventory_ledger l
SET warehouse_id = w.warehouse_id
FROM single_active_warehouse w
WHERE l.branch_id = w.branch_id
  AND l.warehouse_id IS NULL
  AND l.raw_material_id IS NOT NULL;

-- Branches with multiple active warehouses are deliberately left untouched.
-- They require explicit reconciliation because choosing a warehouse would be ambiguous.
DO $$
DECLARE
  v_ambiguous integer;
BEGIN
  SELECT COUNT(*)
  INTO v_ambiguous
  FROM public.raw_material_batches b
  WHERE b.warehouse_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.branch_id = b.branch_id
        AND w.is_active = true
    );

  IF v_ambiguous > 0 THEN
    RAISE NOTICE 'Legacy raw-material batches still lack warehouse identity: % rows; no ambiguous assignment was performed.', v_ambiguous;
  END IF;
END $$;
