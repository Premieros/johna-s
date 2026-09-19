-- Prevent new cross-branch purchase relationships without rewriting historical rows.
--
-- Existing historical purchase headers are intentionally left untouched here.
-- Validation is creation-only so legacy receive/edit/reconciliation workflows
-- can inspect and repair older rows without being blocked by a new trigger.
--
-- No POS, shift, day-close, kitchen, or printing objects are changed.

CREATE OR REPLACE FUNCTION public.enforce_purchase_branch_relationships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_BRANCH_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.warehouse_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.warehouses w
       WHERE w.id = NEW.warehouse_id
         AND w.branch_id = NEW.branch_id
     ) THEN
    RAISE EXCEPTION 'WAREHOUSE_BRANCH_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.supplier_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.suppliers s
       WHERE s.id = NEW.supplier_id
         AND s.branch_id = NEW.branch_id
     ) THEN
    RAISE EXCEPTION 'SUPPLIER_BRANCH_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_purchase_branch_relationships ON public.purchases;
CREATE TRIGGER trg_enforce_purchase_branch_relationships
BEFORE INSERT
ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.enforce_purchase_branch_relationships();

REVOKE ALL ON FUNCTION public.enforce_purchase_branch_relationships() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_purchase_branch_relationships() TO service_role, postgres;

COMMENT ON FUNCTION public.enforce_purchase_branch_relationships()
  IS 'Rejects new purchase branch-supplier-warehouse mismatches. Existing legacy rows and later repair/receive workflows are not blocked by this creation-time guard.';
