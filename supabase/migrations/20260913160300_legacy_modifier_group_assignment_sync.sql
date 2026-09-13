-- Preserve the legacy product_modifier_groups.product_id write contract after
-- reusable modifier groups moved product membership to the junction table.
--
-- Old/stale clients and integration fixtures may still insert/update a group
-- directly with product_id.  Keep that path readable by the POS without
-- making product_id authoritative again and without deleting any reusable
-- assignments.

CREATE OR REPLACE FUNCTION public._sync_legacy_modifier_group_product_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product_branch uuid;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.branch_id
  INTO v_product_branch
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_product_branch IS NULL THEN
    RAISE EXCEPTION 'MODIFIER_PRODUCT_NOT_FOUND';
  END IF;

  IF NEW.branch_id IS DISTINCT FROM v_product_branch THEN
    RAISE EXCEPTION 'MODIFIER_GROUP_PRODUCT_BRANCH_MISMATCH';
  END IF;

  INSERT INTO public.product_modifier_group_products(
    group_id,
    product_id,
    branch_id,
    sort_order
  )
  VALUES (
    NEW.id,
    NEW.product_id,
    NEW.branch_id,
    COALESCE(NEW.sort_order, 0)
  )
  ON CONFLICT (group_id, product_id)
  DO UPDATE SET
    branch_id = EXCLUDED.branch_id,
    sort_order = EXCLUDED.sort_order;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_legacy_modifier_group_product_assignment
ON public.product_modifier_groups;
CREATE TRIGGER trg_sync_legacy_modifier_group_product_assignment
AFTER INSERT OR UPDATE OF product_id, branch_id, sort_order
ON public.product_modifier_groups
FOR EACH ROW
WHEN (NEW.product_id IS NOT NULL)
EXECUTE FUNCTION public._sync_legacy_modifier_group_product_assignment();

REVOKE ALL ON FUNCTION public._sync_legacy_modifier_group_product_assignment()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sync_legacy_modifier_group_product_assignment()
TO service_role, postgres;
