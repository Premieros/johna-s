-- User-visible POS ownership + recipe deletion regression fix.
-- 1) Keep direct recipe deletes denied by RLS; use guarded SECURITY DEFINER RPCs for edits/deletes.
-- 2) Guard open-order cashier reassignment so only a branch-authorized manager capability can change it.

-- Direct deletes remain intentionally denied. The controlled RPCs below are the only mutation boundary.
DROP POLICY IF EXISTS auth_delete_recipe_items ON public.recipe_items;
CREATE POLICY auth_delete_recipe_items
ON public.recipe_items
FOR DELETE
TO authenticated
USING (false);

DROP POLICY IF EXISTS auth_delete_recipes ON public.recipes;
CREATE POLICY auth_delete_recipes
ON public.recipes
FOR DELETE
TO authenticated
USING (false);

CREATE OR REPLACE FUNCTION public.update_recipe_with_items(
  p_recipe_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_notes text,
  p_is_active boolean,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_item jsonb;
  v_raw_material_id uuid;
  v_quantity numeric;
  v_wastage numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('recipes.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'recipes.manage');
  END IF;
  IF p_yield_quantity IS NULL OR p_yield_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_YIELD_QUANTITY');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_ITEMS_REQUIRED');
  END IF;

  SELECT r.branch_id
  INTO v_branch_id
  FROM public.recipes r
  WHERE r.id = p_recipe_id
  FOR UPDATE;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'raw_material_id' AS raw_material_id, count(*) AS c
      FROM jsonb_array_elements(p_items)
      GROUP BY value->>'raw_material_id'
      HAVING count(*) > 1
    ) d
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_RAW_MATERIAL');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_raw_material_id := NULLIF(v_item->>'raw_material_id', '')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      v_wastage := COALESCE((v_item->>'wastage_percent')::numeric, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_RECIPE_ITEM');
    END;

    IF v_raw_material_id IS NULL OR v_quantity <= 0 OR v_wastage < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_RECIPE_ITEM');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.raw_materials rm
      WHERE rm.id = v_raw_material_id
        AND rm.branch_id = v_branch_id
        AND rm.is_active = true
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'RAW_MATERIAL_NOT_IN_BRANCH',
        'raw_material_id', v_raw_material_id
      );
    END IF;
  END LOOP;

  UPDATE public.recipes
  SET name = NULLIF(trim(p_name), ''),
      yield_quantity = p_yield_quantity,
      notes = NULLIF(trim(p_notes), ''),
      is_active = COALESCE(p_is_active, true),
      version = version + 1,
      updated_at = now()
  WHERE id = p_recipe_id;

  DELETE FROM public.recipe_items
  WHERE recipe_id = p_recipe_id;

  INSERT INTO public.recipe_items(recipe_id, raw_material_id, quantity, wastage_percent)
  SELECT
    p_recipe_id,
    (value->>'raw_material_id')::uuid,
    (value->>'quantity')::numeric,
    COALESCE((value->>'wastage_percent')::numeric, 0)
  FROM jsonb_array_elements(p_items);

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'RECIPE_UPDATED',
    'recipe',
    p_recipe_id,
    jsonb_build_object('items_count', jsonb_array_length(p_items)),
    v_branch_id
  );

  RETURN jsonb_build_object('success', true, 'recipe_id', p_recipe_id, 'items_count', jsonb_array_length(p_items));
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_recipe_controlled(p_recipe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_product_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('recipes.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'recipes.manage');
  END IF;

  SELECT r.branch_id, r.product_id
  INTO v_branch_id, v_product_id
  FROM public.recipes r
  WHERE r.id = p_recipe_id
  FOR UPDATE;

  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  DELETE FROM public.recipes WHERE id = p_recipe_id;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'RECIPE_DELETED',
    'recipe',
    p_recipe_id,
    jsonb_build_object('product_id', v_product_id),
    v_branch_id
  );

  RETURN jsonb_build_object('success', true, 'recipe_id', p_recipe_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_recipe_with_items(uuid, text, numeric, text, boolean, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_recipe_with_items(uuid, text, numeric, text, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_recipe_with_items(uuid, text, numeric, text, boolean, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_recipe_controlled(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_recipe_controlled(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_recipe_controlled(uuid) TO authenticated, service_role;

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
