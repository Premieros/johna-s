-- Historical-safe catalog archive.
-- Forward-only: preserve operational/accounting history while preventing future use.

-- Recipes already carry a version column. Make that versioning real: retain old
-- rows and allow exactly one active version for each product/branch.
ALTER TABLE public.recipes
  DROP CONSTRAINT IF EXISTS recipes_product_id_branch_id_key;
DROP INDEX IF EXISTS public.recipes_product_id_branch_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS recipes_one_active_per_product_branch
  ON public.recipes(product_id, branch_id)
  WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS recipes_product_branch_version_key
  ON public.recipes(product_id, branch_id, version);

-- Inserts into a new (possibly inactive) historical version still require a
-- same-branch, currently selectable raw material. Existing historical rows are
-- never rewritten by this trigger.
CREATE OR REPLACE FUNCTION public.validate_recipe_item_branch_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.recipes r
    JOIN public.raw_materials rm
      ON rm.id = NEW.raw_material_id
     AND rm.branch_id = r.branch_id
     AND rm.is_active = true
    WHERE r.id = NEW.recipe_id
  ) THEN
    RAISE EXCEPTION 'RAW_MATERIAL_BRANCH_MISMATCH'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- Recipe edits now create a new row/version instead of deleting old items.
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
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old public.recipes%ROWTYPE;
  v_new_id uuid;
  v_new_version integer;
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

  SELECT * INTO v_old FROM public.recipes WHERE id = p_recipe_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_old.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT v_old.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'RECIPE_NOT_CURRENT');
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
      SELECT 1 FROM public.raw_materials rm
      WHERE rm.id = v_raw_material_id
        AND rm.branch_id = v_old.branch_id
        AND rm.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_NOT_IN_BRANCH', 'raw_material_id', v_raw_material_id);
    END IF;
  END LOOP;

  SELECT COALESCE(max(r.version), 0) + 1
    INTO v_new_version
  FROM public.recipes r
  WHERE r.product_id = v_old.product_id AND r.branch_id = v_old.branch_id;

  UPDATE public.recipes
  SET is_active = false, updated_at = now()
  WHERE id = v_old.id;

  INSERT INTO public.recipes(
    product_id, branch_id, name, yield_quantity, notes, is_active, version
  ) VALUES (
    v_old.product_id,
    v_old.branch_id,
    NULLIF(trim(p_name), ''),
    p_yield_quantity,
    NULLIF(trim(p_notes), ''),
    COALESCE(p_is_active, true),
    v_new_version
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.recipe_items(recipe_id, raw_material_id, quantity, wastage_percent)
  SELECT
    v_new_id,
    (value->>'raw_material_id')::uuid,
    (value->>'quantity')::numeric,
    COALESCE((value->>'wastage_percent')::numeric, 0)
  FROM jsonb_array_elements(p_items);

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(), 'RECIPE_VERSION_CREATED', 'recipe', v_new_id,
    jsonb_build_object(
      'previous_recipe_id', v_old.id,
      'previous_version', v_old.version,
      'version', v_new_version,
      'items_count', jsonb_array_length(p_items),
      'is_active', COALESCE(p_is_active, true)
    ),
    v_old.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'recipe_id', v_new_id,
    'previous_recipe_id', v_old.id,
    'version', v_new_version,
    'items_count', jsonb_array_length(p_items)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_raw_material(p_raw_material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raw public.raw_materials%ROWTYPE;
  v_recipe public.recipes%ROWTYPE;
  v_new_recipe_id uuid;
  v_new_version integer;
  v_remaining integer;
  v_used boolean := false;
  v_recipe_versions integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('raw_materials.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'raw_materials.manage');
  END IF;

  SELECT * INTO v_raw
  FROM public.raw_materials
  WHERE id = p_raw_material_id
  FOR UPDATE;

  -- Idempotent for a previously hard-deleted, never-used row.
  IF v_raw.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'mode', 'already_absent', 'raw_material_id', p_raw_material_id);
  END IF;
  IF NOT public.user_may_access_branch(v_raw.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT v_raw.is_active THEN
    RETURN jsonb_build_object('success', true, 'mode', 'archived', 'already_archived', true, 'raw_material_id', v_raw.id);
  END IF;

  -- Physical deletion is allowed only when absolutely no FK child row exists.
  -- This deliberately includes current stock-state rows, because deleting a
  -- referenced row must never rely on CASCADE to decide what is historical.
  SELECT EXISTS (
    SELECT 1 FROM public.inventory_ledger x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.inventory_unit_recipes x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.order_inventory_consumptions x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.product_modifier_inventory_effects x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.production_waste x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.purchase_items x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.purchase_request_items x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.raw_material_batches x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.raw_material_inventory x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.raw_material_movements x WHERE x.material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.recipe_items x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.rfq_items x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.stock_count_items x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.supplier_quotation_items x WHERE x.raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.warehouse_transfer_items x WHERE x.raw_material_id = v_raw.id OR x.destination_raw_material_id = v_raw.id
    UNION ALL SELECT 1 FROM public.waste_entries x WHERE x.raw_material_id = v_raw.id
  ) INTO v_used;

  IF NOT v_used THEN
    DELETE FROM public.raw_materials WHERE id = v_raw.id;
    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
    VALUES (auth.uid(), 'RAW_MATERIAL_HARD_DELETED', 'raw_material', v_raw.id,
            jsonb_build_object('code', v_raw.code, 'reason', 'never_used'), v_raw.branch_id);
    RETURN jsonb_build_object('success', true, 'mode', 'deleted', 'raw_material_id', v_raw.id);
  END IF;

  -- Archive first so it is immediately unavailable to every future selector and
  -- to recipe validation. Historical references remain intact.
  UPDATE public.raw_materials
  SET is_active = false, updated_at = now()
  WHERE id = v_raw.id;

  -- For each active recipe that used the material, preserve the old row/items
  -- as history, then create a future active version without archived materials.
  FOR v_recipe IN
    SELECT r.*
    FROM public.recipes r
    WHERE r.branch_id = v_raw.branch_id
      AND r.is_active = true
      AND EXISTS (
        SELECT 1 FROM public.recipe_items ri
        WHERE ri.recipe_id = r.id AND ri.raw_material_id = v_raw.id
      )
    ORDER BY r.product_id, r.id
    FOR UPDATE
  LOOP
    UPDATE public.recipes SET is_active = false, updated_at = now() WHERE id = v_recipe.id;

    SELECT count(*) INTO v_remaining
    FROM public.recipe_items ri
    JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
    WHERE ri.recipe_id = v_recipe.id
      AND ri.raw_material_id <> v_raw.id
      AND rm.is_active = true;

    IF v_remaining > 0 THEN
      SELECT COALESCE(max(r.version), 0) + 1 INTO v_new_version
      FROM public.recipes r
      WHERE r.product_id = v_recipe.product_id AND r.branch_id = v_recipe.branch_id;

      INSERT INTO public.recipes(
        product_id, branch_id, name, yield_quantity, notes, is_active, version
      ) VALUES (
        v_recipe.product_id, v_recipe.branch_id, v_recipe.name,
        v_recipe.yield_quantity, v_recipe.notes, true, v_new_version
      ) RETURNING id INTO v_new_recipe_id;

      INSERT INTO public.recipe_items(recipe_id, raw_material_id, quantity, wastage_percent, note)
      SELECT v_new_recipe_id, ri.raw_material_id, ri.quantity, ri.wastage_percent, ri.note
      FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = v_recipe.id
        AND ri.raw_material_id <> v_raw.id
        AND rm.is_active = true
      ORDER BY ri.created_at, ri.id;

      v_recipe_versions := v_recipe_versions + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(), 'RAW_MATERIAL_ARCHIVED', 'raw_material', v_raw.id,
    jsonb_build_object(
      'code', v_raw.code,
      'preserved_history', true,
      'future_recipe_versions_created', v_recipe_versions
    ),
    v_raw.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'archived',
    'raw_material_id', v_raw.id,
    'future_recipe_versions_created', v_recipe_versions
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_used boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('products.delete') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.delete');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'mode', 'already_absent', 'product_id', p_product_id);
  END IF;
  IF NOT public.user_may_access_branch(v_product.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT v_product.is_active THEN
    RETURN jsonb_build_object('success', true, 'mode', 'archived', 'already_archived', true, 'product_id', v_product.id);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.inventory_batches x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.inventory_ledger x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.inventory_movements x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.order_inventory_consumptions x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.order_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.order_kitchen_voids x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.product_components x WHERE x.product_id = v_product.id OR x.component_product_id = v_product.id
    UNION ALL SELECT 1 FROM public.product_cost_history x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.product_modifier_group_products x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.product_modifier_groups x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.product_unit_links x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.product_units x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.production_orders x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.production_waste x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.purchase_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.purchase_request_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.recipes x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.rfq_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.sale_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.stock_count_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.stock_transactions x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.supplier_quotation_items x WHERE x.product_id = v_product.id
    UNION ALL SELECT 1 FROM public.warehouse_transfer_items x WHERE x.product_id = v_product.id OR x.destination_product_id = v_product.id
    UNION ALL SELECT 1 FROM public.waste_entries x WHERE x.product_id = v_product.id
  ) INTO v_used;

  IF NOT v_used THEN
    DELETE FROM public.products WHERE id = v_product.id;
    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
    VALUES (auth.uid(), 'PRODUCT_HARD_DELETED', 'product', v_product.id,
            jsonb_build_object('name', v_product.name, 'reason', 'never_used'), v_product.branch_id);
    RETURN jsonb_build_object('success', true, 'mode', 'deleted', 'product_id', v_product.id);
  END IF;

  UPDATE public.products SET is_active = false, updated_at = now() WHERE id = v_product.id;
  UPDATE public.recipes SET is_active = false, updated_at = now()
  WHERE product_id = v_product.id AND branch_id = v_product.branch_id AND is_active = true;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (auth.uid(), 'PRODUCT_ARCHIVED', 'product', v_product.id,
          jsonb_build_object('name', v_product.name, 'preserved_history', true), v_product.branch_id);

  RETURN jsonb_build_object('success', true, 'mode', 'archived', 'product_id', v_product.id);
END;
$function$;

-- Current costing must only read the effective active recipe after historical
-- versions begin to coexist.
CREATE OR REPLACE FUNCTION public._product_recipe_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH effective_recipe AS (
    SELECT r.id
    FROM public.recipes r
    WHERE r.product_id = p_product_id
      AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
      AND r.is_active = true
    ORDER BY r.version DESC, r.created_at DESC
    LIMIT 1
  )
  SELECT COALESCE(round(SUM(
    ri.quantity * (1 + COALESCE(ri.wastage_percent, 0) / 100.0) *
    COALESCE(public._raw_wavg_cost(ri.raw_material_id, p_branch_id), 0)
  ), 2), 0)
  FROM public.recipe_items ri
  JOIN effective_recipe er ON er.id = ri.recipe_id
$function$;

REVOKE ALL ON FUNCTION public.archive_raw_material(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_product(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_raw_material(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_product(uuid) TO authenticated;
