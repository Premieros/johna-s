-- ============================================================================
-- 20260912140000_catalog_create_contract.sql
--
-- PR 3 / 6A: unified create contract for catalog entities (raw materials +
-- products). Creates two SECURITY DEFINER RPCs that become the single
-- mutation boundary for catalog creation, mirroring the permission-first
-- conventions of update_recipe_with_items (20260906180000):
--
--   * auth.uid() + active-user checks
--   * explicit role permission (products.create / raw_materials.manage)
--   * branch authorization via user_may_access_branch (admin may bypass)
--   * server-side validation including a REQUIRED measurement unit for raw
--     materials (raw_materials.unit_id is only nullable because legacy rows
--     predate the invariant; new rows require one)
--   * structured jsonb result, never a raised exception for a rejected call
--   * atomicity (single statement = single transaction; inner BEGIN block
--     maps unique/check/FK violations to a clean result instead of aborting)
--   * authoritative audit_log row for the created entity
--
-- Additive-only: creates two new functions, touches no existing object.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_raw_material(p_code, p_name, p_unit_id, ...)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_raw_material(
  p_code text,
  p_name text,
  p_unit_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_min_stock numeric DEFAULT 0,
  p_default_cost numeric DEFAULT 0,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_effective_branch uuid;
  v_id uuid;
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

  IF NULLIF(trim(coalesce(p_code, '')), '') IS NULL OR NULLIF(trim(coalesce(p_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
  END IF;
  IF p_unit_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNIT_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.measurement_units u WHERE u.id = p_unit_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNIT_NOT_FOUND');
  END IF;
  IF COALESCE(p_min_stock, 0) < 0 OR COALESCE(p_default_cost, 0) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
  END IF;

  -- Effective branch: explicit accessible branch wins; otherwise the user's
  -- own branch; a user with no branch must pass one explicitly.
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF p_branch_id IS NOT NULL THEN
    v_effective_branch := p_branch_id;
  ELSE
    SELECT branch_id INTO v_effective_branch FROM public.users WHERE id = auth.uid();
  END IF;
  IF v_effective_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_REQUIRED');
  END IF;

  BEGIN
    INSERT INTO public.raw_materials (code, name, unit_id, category, min_stock, default_cost, description, is_active, branch_id)
    VALUES (
      trim(p_code),
      trim(p_name),
      p_unit_id,
      NULLIF(trim(coalesce(p_category, '')), ''),
      COALESCE(p_min_stock, 0),
      COALESCE(p_default_cost, 0),
      NULLIF(trim(coalesce(p_description, '')), ''),
      COALESCE(p_is_active, true),
      v_effective_branch
    )
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
    VALUES (
      auth.uid(),
      'RAW_MATERIAL_CREATED',
      'raw_material',
      v_id,
      jsonb_build_object('code', trim(p_code), 'name', trim(p_name), 'unit_id', p_unit_id, 'has_unit', true),
      v_effective_branch
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_CODE');
    WHEN check_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
  END;

  RETURN jsonb_build_object('success', true, 'raw_material_id', v_id, 'branch_id', v_effective_branch);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_raw_material(text, text, uuid, uuid, text, numeric, numeric, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_raw_material(text, text, uuid, uuid, text, numeric, numeric, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_raw_material(text, text, uuid, uuid, text, numeric, numeric, text, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- create_product(p_name, p_branch_id, ...)
-- Captures exactly what ProductsPage.create / ProductSetupWizardPage /
-- the Excel import did today, atomically:
--   * the products row (including the 071 ordering-policy columns)
--   * legacy product_units (p_units) with the same validation as
--     replace_product_units (non-empty => a base unit is required)
--   * the canonical inventory-unit links (p_unit_links) into
--     product_unit_links for manufactured products
-- Recipe/recipe_items wiring stays out of scope for this contract (the
-- guarded edit path already exists; a dedicated create-recipe boundary is a
-- follow-up). Direct DML on products/product_units/product_unit_links remains
-- untouched for update/delete paths.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product(
  p_name text,
  p_branch_id uuid,
  p_name_en text DEFAULT NULL,
  p_barcode text DEFAULT NULL,
  p_sku text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_cost_price numeric DEFAULT 0,
  p_sale_price numeric DEFAULT 0,
  p_wholesale_price numeric DEFAULT 0,
  p_low_stock_threshold integer DEFAULT 5,
  p_min_stock numeric DEFAULT 0,
  p_max_stock numeric DEFAULT 0,
  p_reorder_point numeric DEFAULT 0,
  p_product_type text DEFAULT 'ready',
  p_is_active boolean DEFAULT true,
  p_units jsonb DEFAULT NULL,
  p_unit_links jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_effective_branch uuid;
  v_id uuid;
  v_units_count integer;
  v_base_count integer;
  v_links_count integer;
  v_item jsonb;
  v_unit_id uuid;
  v_quantity numeric;
  v_seen_units uuid[] := '{}'::uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('products.create') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'products.create');
  END IF;

  IF NULLIF(trim(coalesce(p_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
  END IF;
  IF COALESCE(p_product_type, 'ready') NOT IN ('ready', 'manufactured') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRODUCT_TYPE');
  END IF;
  IF COALESCE(p_cost_price, 0) < 0 OR COALESCE(p_sale_price, 0) < 0
     OR COALESCE(p_wholesale_price, 0) < 0 OR COALESCE(p_low_stock_threshold, 0) < 0
     OR COALESCE(p_min_stock, 0) < 0 OR COALESCE(p_max_stock, 0) < 0
     OR COALESCE(p_reorder_point, 0) < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = p_category_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_NOT_FOUND');
  END IF;
  IF p_units IS NOT NULL AND jsonb_typeof(p_units) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_UNITS');
  END IF;
  IF p_unit_links IS NOT NULL AND jsonb_typeof(p_unit_links) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_UNIT_LINK');
  END IF;

  -- Effective branch: explicit accessible branch wins; otherwise the user's
  -- own branch; a user with no branch must pass one explicitly.
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF p_branch_id IS NOT NULL THEN
    v_effective_branch := p_branch_id;
  ELSE
    SELECT branch_id INTO v_effective_branch FROM public.users WHERE id = auth.uid();
  END IF;
  IF v_effective_branch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_REQUIRED');
  END IF;

  -- Legacy product_units: same contract as replace_product_units — if the
  -- array is present it must contain at least one base unit.
  IF p_units IS NOT NULL THEN
    SELECT count(*) INTO v_units_count FROM jsonb_array_elements(p_units);
    SELECT count(*) INTO v_base_count
    FROM jsonb_array_elements(p_units) AS t(u)
    WHERE COALESCE((t.u->>'is_base')::boolean, false);
    IF v_units_count = 0 OR v_base_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_BASE_UNIT');
    END IF;
  ELSE
    v_units_count := 0;
  END IF;

  -- Canonical unit links (product_unit_links) validation up front.
  IF p_unit_links IS NOT NULL THEN
    v_links_count := 0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_unit_links)
    LOOP
      BEGIN
        v_unit_id := NULLIF(v_item->>'unit_id', '')::uuid;
        v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_UNIT_LINK');
      END;
      IF v_unit_id IS NULL OR v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_UNIT_LINK');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.inventory_units iu WHERE iu.id = v_unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNIT_NOT_FOUND');
      END IF;
      IF v_unit_id = ANY(v_seen_units) THEN
        RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_UNIT_LINK');
      END IF;
      v_seen_units := array_append(v_seen_units, v_unit_id);
      v_links_count := v_links_count + 1;
    END LOOP;
  ELSE
    v_links_count := 0;
  END IF;

  BEGIN
    INSERT INTO public.products (
      name, name_en, barcode, sku, category_id, description, image_url,
      cost_price, sale_price, wholesale_price, low_stock_threshold,
      min_stock, max_stock, reorder_point, product_type, is_active, branch_id
    )
    VALUES (
      trim(p_name),
      NULLIF(trim(coalesce(p_name_en, '')), ''),
      NULLIF(trim(coalesce(p_barcode, '')), ''),
      NULLIF(trim(coalesce(p_sku, '')), ''),
      p_category_id,
      NULLIF(trim(coalesce(p_description, '')), ''),
      NULLIF(trim(coalesce(p_image_url, '')), ''),
      COALESCE(p_cost_price, 0),
      COALESCE(p_sale_price, 0),
      COALESCE(p_wholesale_price, 0),
      COALESCE(p_low_stock_threshold, 5),
      COALESCE(p_min_stock, 0),
      COALESCE(p_max_stock, 0),
      COALESCE(p_reorder_point, 0),
      p_product_type,
      COALESCE(p_is_active, true),
      v_effective_branch
    )
    RETURNING id INTO v_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb))
    LOOP
      IF NULLIF(v_item->>'unit_name', '') IS NULL THEN
        CONTINUE;
      END IF;
      INSERT INTO public.product_units (
        product_id, unit_name, unit_name_en, conversion_factor,
        sale_price, cost_price, barcode, is_base
      ) VALUES (
        v_id,
        v_item->>'unit_name',
        COALESCE(v_item->>'unit_name_en', v_item->>'unit_name'),
        COALESCE((v_item->>'conversion_factor')::numeric, 1),
        COALESCE((v_item->>'sale_price')::numeric, 0),
        COALESCE((v_item->>'cost_price')::numeric, 0),
        NULLIF(v_item->>'barcode', ''),
        COALESCE((v_item->>'is_base')::boolean, false)
      );
    END LOOP;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_unit_links, '[]'::jsonb))
    LOOP
      INSERT INTO public.product_unit_links (product_id, unit_id, quantity)
      VALUES (
        v_id,
        (v_item->>'unit_id')::uuid,
        COALESCE((v_item->>'quantity')::numeric, 1)
      );
    END LOOP;

    INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
    VALUES (
      auth.uid(),
      'PRODUCT_CREATED',
      'product',
      v_id,
      jsonb_build_object(
        'name', trim(p_name),
        'product_type', p_product_type,
        'units_count', v_units_count,
        'unit_links_count', v_links_count,
        'has_unit_links', v_links_count > 0
      ),
      v_effective_branch
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'DUPLICATE_ROW');
    WHEN check_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_INPUT');
    WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('success', false, 'error', 'REFERENCED_ROW_MISSING');
  END;

  RETURN jsonb_build_object('success', true, 'product_id', v_id, 'branch_id', v_effective_branch, 'units', v_units_count, 'unit_links', v_links_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_product(text, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, text, boolean, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_product(text, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, text, boolean, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_product(text, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, text, boolean, jsonb, jsonb) TO authenticated, service_role;