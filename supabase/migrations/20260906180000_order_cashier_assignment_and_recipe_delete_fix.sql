-- User-visible POS ownership + recipe deletion regression fix.
-- 1) Re-enable recipe / recipe-item deletes only through canonical permission + branch scope.
-- 2) Guard open-order cashier reassignment so only a branch-authorized manager capability can change it.

DROP POLICY IF EXISTS auth_delete_recipe_items ON public.recipe_items;
CREATE POLICY auth_delete_recipe_items
ON public.recipe_items
FOR DELETE
TO authenticated
USING (
  public.is_platform_admin()
  OR (
    public.can_permission('recipes.manage')
    AND EXISTS (
      SELECT 1
      FROM public.recipes r
      WHERE r.id = recipe_items.recipe_id
        AND public.user_may_access_branch(r.branch_id)
    )
  )
);

DROP POLICY IF EXISTS auth_delete_recipes ON public.recipes;
CREATE POLICY auth_delete_recipes
ON public.recipes
FOR DELETE
TO authenticated
USING (
  public.is_platform_admin()
  OR (
    public.can_permission('recipes.manage')
    AND public.user_may_access_branch(branch_id)
  )
);

CREATE OR REPLACE FUNCTION public.guard_order_cashier_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_target_ok boolean := false;
BEGIN
  IF NEW.cashier_id IS NOT DISTINCT FROM OLD.cashier_id THEN
    RETURN NEW;
  END IF;

  -- Trusted internal/service work is not a user reassignment action.
  IF v_is_service_role OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status NOT IN ('open', 'held') THEN
    RAISE EXCEPTION 'ORDER_CLOSED';
  END IF;

  IF NOT public.user_may_access_branch(OLD.branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  -- Reassignment is intentionally manager-scoped without role-name checks.
  -- pos.order.transfer = operational transfer capability
  -- users.manage = managerial user-assignment capability
  -- pos.order.edit = existing order mutation boundary
  IF NOT public.can_permission('pos.order.transfer')
     OR NOT public.can_permission('users.manage')
     OR NOT public.can_permission('pos.order.edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:order_cashier_assignment';
  END IF;

  IF NEW.cashier_id IS NULL THEN
    RAISE EXCEPTION 'CASHIER_REQUIRED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = NEW.cashier_id
      AND u.is_active = true
      AND (
        u.branch_id = OLD.branch_id
        OR EXISTS (
          SELECT 1
          FROM public.user_branch_access uba
          WHERE uba.user_id = u.id
            AND uba.branch_id = OLD.branch_id
        )
      )
  )
  INTO v_target_ok;

  IF NOT v_target_ok THEN
    RAISE EXCEPTION 'TARGET_USER_NOT_IN_BRANCH';
  END IF;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    'ORDER_CASHIER_REASSIGNED',
    'order',
    OLD.id,
    jsonb_build_object(
      'order_number', OLD.order_number,
      'from_cashier_id', OLD.cashier_id,
      'to_cashier_id', NEW.cashier_id
    ),
    OLD.branch_id
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_order_cashier_assignment ON public.orders;
CREATE TRIGGER trg_guard_order_cashier_assignment
BEFORE UPDATE OF cashier_id ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_order_cashier_assignment();

REVOKE ALL ON FUNCTION public.guard_order_cashier_assignment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_order_cashier_assignment() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_order_cashier_assignment() TO service_role;
