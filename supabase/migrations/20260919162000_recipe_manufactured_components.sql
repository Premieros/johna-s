-- Allow recipe managers to compose a product recipe with manufactured inventory units
-- without changing POS/kitchen deduction logic. The existing product_unit_links
-- contract remains the operational source for manufactured-unit consumption.

CREATE OR REPLACE FUNCTION public.set_recipe_manufactured_components(
  p_recipe_id uuid,
  p_components jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_product_id uuid;
  v_yield numeric;
  v_item jsonb;
  v_unit_id uuid;
  v_qty numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  IF NOT public.can_permission('recipes.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'recipes.manage');
  END IF;

  SELECT r.branch_id, r.product_id, GREATEST(COALESCE(r.yield_quantity, 1), 0.0001)
  INTO v_branch_id, v_product_id, v_yield
  FROM public.recipes r
  WHERE r.id = p_recipe_id
  FOR UPDATE;

  IF v_branch_id IS NULL OR v_product_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_COMPONENTS');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'unit_id' AS unit_id, count(*) AS c
      FROM jsonb_array_elements(p_components)
      GROUP BY value->>'unit_id'
      HAVING count(*) > 1
    ) d
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_MANUFACTURED_COMPONENT');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_components)
  LOOP
    BEGIN
      v_unit_id := NULLIF(v_item->>'unit_id', '')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_MANUFACTURED_COMPONENT');
    END;

    IF v_unit_id IS NULL OR v_qty <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_MANUFACTURED_COMPONENT');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.inventory_units iu
      WHERE iu.id = v_unit_id
        AND iu.branch_id = v_branch_id
        AND iu.is_active = true
        AND iu.unit_type = 'manufactured'
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MANUFACTURED_COMPONENT_NOT_IN_BRANCH',
        'unit_id', v_unit_id
      );
    END IF;
  END LOOP;

  -- Preserve ready-unit links. Only manufactured-unit composition is replaced.
  DELETE FROM public.product_unit_links pul
  USING public.inventory_units iu
  WHERE pul.product_id = v_product_id
    AND pul.unit_id = iu.id
    AND iu.unit_type = 'manufactured'
    AND iu.branch_id = v_branch_id;

  INSERT INTO public.product_unit_links(product_id, unit_id, quantity)
  SELECT
    v_product_id,
    (value->>'unit_id')::uuid,
    round(((value->>'quantity')::numeric / v_yield), 6)
  FROM jsonb_array_elements(p_components)
  WHERE COALESCE((value->>'quantity')::numeric, 0) > 0;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'RECIPE_MANUFACTURED_COMPONENTS_UPDATED',
    'recipe',
    p_recipe_id,
    jsonb_build_object('components_count', jsonb_array_length(p_components), 'yield_quantity', v_yield),
    v_branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'recipe_id', p_recipe_id,
    'components_count', jsonb_array_length(p_components)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_recipe_manufactured_components(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_recipe_manufactured_components(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_recipe_manufactured_components(uuid, jsonb)
  IS 'Permission-first recipe editor boundary for manufactured inventory-unit components. Writes only manufactured product_unit_links and leaves POS/kitchen deduction logic unchanged.';
