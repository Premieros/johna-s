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


CREATE OR REPLACE FUNCTION public.save_recipe_composition(
  p_recipe_id uuid,
  p_product_id uuid,
  p_branch_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_notes text,
  p_is_active boolean,
  p_raw_items jsonb,
  p_manufactured_components jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_recipe_id uuid;
  v_existing_product_id uuid;
  v_existing_branch_id uuid;
  v_item jsonb;
  v_raw_id uuid;
  v_unit_id uuid;
  v_qty numeric;
  v_waste numeric;
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

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF p_product_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH');
  END IF;

  IF p_yield_quantity IS NULL OR p_yield_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_YIELD_QUANTITY');
  END IF;

  IF p_raw_items IS NULL OR jsonb_typeof(p_raw_items) <> 'array'
     OR p_manufactured_components IS NULL OR jsonb_typeof(p_manufactured_components) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_COMPONENTS');
  END IF;

  IF jsonb_array_length(p_raw_items) + jsonb_array_length(p_manufactured_components) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_ITEMS_REQUIRED');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'raw_material_id' AS id, count(*) AS c
      FROM jsonb_array_elements(p_raw_items)
      GROUP BY value->>'raw_material_id'
      HAVING count(*) > 1
    ) d
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_RAW_MATERIAL');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT value->>'unit_id' AS id, count(*) AS c
      FROM jsonb_array_elements(p_manufactured_components)
      GROUP BY value->>'unit_id'
      HAVING count(*) > 1
    ) d
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_MANUFACTURED_COMPONENT');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_raw_items)
  LOOP
    BEGIN
      v_raw_id := NULLIF(v_item->>'raw_material_id', '')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      v_waste := COALESCE((v_item->>'wastage_percent')::numeric, 0);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_RECIPE_ITEM');
    END;

    IF v_raw_id IS NULL OR v_qty <= 0 OR v_waste < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_RECIPE_ITEM');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.raw_materials rm
      WHERE rm.id = v_raw_id
        AND rm.branch_id = p_branch_id
        AND rm.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_NOT_IN_BRANCH', 'raw_material_id', v_raw_id);
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_manufactured_components)
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
      SELECT 1 FROM public.inventory_units iu
      WHERE iu.id = v_unit_id
        AND iu.branch_id = p_branch_id
        AND iu.is_active = true
        AND iu.unit_type = 'manufactured'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'MANUFACTURED_COMPONENT_NOT_IN_BRANCH', 'unit_id', v_unit_id);
    END IF;
  END LOOP;

  IF p_recipe_id IS NULL THEN
    INSERT INTO public.recipes(product_id, branch_id, name, yield_quantity, notes, is_active)
    VALUES (
      p_product_id,
      p_branch_id,
      NULLIF(trim(p_name), ''),
      p_yield_quantity,
      NULLIF(trim(p_notes), ''),
      COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_recipe_id;
  ELSE
    SELECT r.product_id, r.branch_id
    INTO v_existing_product_id, v_existing_branch_id
    FROM public.recipes r
    WHERE r.id = p_recipe_id
    FOR UPDATE;

    IF v_existing_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_FOUND');
    END IF;

    IF v_existing_branch_id IS DISTINCT FROM p_branch_id
       OR v_existing_product_id IS DISTINCT FROM p_product_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'RECIPE_IDENTITY_MISMATCH');
    END IF;

    v_recipe_id := p_recipe_id;

    UPDATE public.recipes
    SET name = NULLIF(trim(p_name), ''),
        yield_quantity = p_yield_quantity,
        notes = NULLIF(trim(p_notes), ''),
        is_active = COALESCE(p_is_active, true),
        version = version + 1,
        updated_at = now()
    WHERE id = v_recipe_id;
  END IF;

  DELETE FROM public.recipe_items
  WHERE recipe_id = v_recipe_id;

  INSERT INTO public.recipe_items(recipe_id, raw_material_id, quantity, wastage_percent)
  SELECT
    v_recipe_id,
    (value->>'raw_material_id')::uuid,
    (value->>'quantity')::numeric,
    COALESCE((value->>'wastage_percent')::numeric, 0)
  FROM jsonb_array_elements(p_raw_items)
  WHERE COALESCE((value->>'quantity')::numeric, 0) > 0;

  DELETE FROM public.product_unit_links pul
  USING public.inventory_units iu
  WHERE pul.product_id = p_product_id
    AND pul.unit_id = iu.id
    AND iu.unit_type = 'manufactured'
    AND iu.branch_id = p_branch_id;

  INSERT INTO public.product_unit_links(product_id, unit_id, quantity)
  SELECT
    p_product_id,
    (value->>'unit_id')::uuid,
    round(((value->>'quantity')::numeric / p_yield_quantity), 6)
  FROM jsonb_array_elements(p_manufactured_components)
  WHERE COALESCE((value->>'quantity')::numeric, 0) > 0;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    CASE WHEN p_recipe_id IS NULL THEN 'RECIPE_CREATED' ELSE 'RECIPE_UPDATED' END,
    'recipe',
    v_recipe_id,
    jsonb_build_object(
      'raw_items_count', jsonb_array_length(p_raw_items),
      'manufactured_components_count', jsonb_array_length(p_manufactured_components),
      'yield_quantity', p_yield_quantity
    ),
    p_branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'recipe_id', v_recipe_id,
    'raw_items_count', jsonb_array_length(p_raw_items),
    'manufactured_components_count', jsonb_array_length(p_manufactured_components)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_recipe_composition(uuid, uuid, uuid, text, numeric, text, boolean, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_recipe_composition(uuid, uuid, uuid, text, numeric, text, boolean, jsonb, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.save_recipe_composition(uuid, uuid, uuid, text, numeric, text, boolean, jsonb, jsonb)
  IS 'Atomic permission-first recipe save for raw materials plus manufactured inventory-unit components. Operational POS/kitchen consumption contracts are unchanged.';
