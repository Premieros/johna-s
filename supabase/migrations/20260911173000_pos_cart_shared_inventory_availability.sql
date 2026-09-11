-- Cart-aware POS availability.
-- This migration is read-only with respect to business inventory: it only reads
-- warehouse stock and uses temporary tables to aggregate the current unsent cart.
-- Physical deduction remains owned by the canonical kitchen/sale flow.

CREATE OR REPLACE FUNCTION public.check_pos_cart_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_recipe_id uuid;
  v_yield numeric;
  v_link_count integer;
  v_direct_raw_count integer;
  v_row record;
  v_delta numeric;
  v_available numeric;
  v_remaining_stock numeric;
  v_cover numeric;
  v_shortage numeric;
  v_unit_type text;
  v_iter integer := 0;
BEGIN
  IF p_items IS NULL THEN p_items := '[]'::jsonb; END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEMS');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_ACCESS_DENIED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id AND w.branch_id = p_branch_id AND w.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.cart_raw_need(
    raw_material_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.cart_unit_need(
    unit_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0,
    processed_qty numeric NOT NULL DEFAULT 0,
    stock_used numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.cart_ready_need(
    product_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.cart_raw_need;
  TRUNCATE pg_temp.cart_unit_need;
  TRUNCATE pg_temp.cart_ready_need;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM');
    END;

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_product_id AND p.branch_id = p_branch_id AND p.is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
    END IF;

    SELECT COUNT(*) INTO v_link_count
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id = pul.unit_id
    WHERE pul.product_id = v_product_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true;

    INSERT INTO pg_temp.cart_unit_need(unit_id, required_qty)
    SELECT pul.unit_id, v_quantity * pul.quantity
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id = pul.unit_id
    WHERE pul.product_id = v_product_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true
    ON CONFLICT(unit_id) DO UPDATE
    SET required_qty = pg_temp.cart_unit_need.required_qty + EXCLUDED.required_qty;

    v_recipe_id := NULL;
    v_yield := 1;
    SELECT r.id, COALESCE(NULLIF(r.yield_quantity, 0), 1)
      INTO v_recipe_id, v_yield
    FROM public.recipes r
    WHERE r.product_id = v_product_id
      AND r.branch_id = p_branch_id
      AND COALESCE(r.is_active, true) = true
    ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC
    LIMIT 1;

    v_direct_raw_count := 0;
    IF v_recipe_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_direct_raw_count
      FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = v_recipe_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.product_unit_links pul
          JOIN public.inventory_units iu ON iu.id = pul.unit_id
          WHERE pul.product_id = v_product_id
            AND iu.branch_id = p_branch_id
            AND iu.is_active = true
            AND regexp_replace(lower(btrim(iu.name)), '[ .]+$', '', 'g') =
                regexp_replace(lower(btrim(rm.name)), '[ .]+$', '', 'g')
        );

      INSERT INTO pg_temp.cart_raw_need(raw_material_id, required_qty)
      SELECT ri.raw_material_id, v_quantity * (ri.quantity / v_yield)
      FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = v_recipe_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.product_unit_links pul
          JOIN public.inventory_units iu ON iu.id = pul.unit_id
          WHERE pul.product_id = v_product_id
            AND iu.branch_id = p_branch_id
            AND iu.is_active = true
            AND regexp_replace(lower(btrim(iu.name)), '[ .]+$', '', 'g') =
                regexp_replace(lower(btrim(rm.name)), '[ .]+$', '', 'g')
        )
      ON CONFLICT(raw_material_id) DO UPDATE
      SET required_qty = pg_temp.cart_raw_need.required_qty + EXCLUDED.required_qty;
    END IF;

    IF v_link_count = 0 AND v_direct_raw_count = 0 THEN
      INSERT INTO pg_temp.cart_ready_need(product_id, required_qty)
      VALUES(v_product_id, v_quantity)
      ON CONFLICT(product_id) DO UPDATE
      SET required_qty = pg_temp.cart_ready_need.required_qty + EXCLUDED.required_qty;
    END IF;
  END LOOP;

  -- Expand the aggregate manufactured-unit shortages only once for the whole cart.
  LOOP
    SELECT * INTO v_row
    FROM pg_temp.cart_unit_need
    WHERE required_qty > processed_qty + 0.0000001
    ORDER BY unit_id
    LIMIT 1;
    EXIT WHEN NOT FOUND;

    v_iter := v_iter + 1;
    IF v_iter > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNIT_RECIPE_CYCLE_OR_TOO_DEEP');
    END IF;

    v_delta := v_row.required_qty - v_row.processed_qty;
    SELECT iu.unit_type INTO v_unit_type
    FROM public.inventory_units iu
    WHERE iu.id = v_row.unit_id AND iu.branch_id = p_branch_id AND iu.is_active = true;
    IF v_unit_type IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVENTORY_UNIT_NOT_AVAILABLE', 'unit_id', v_row.unit_id);
    END IF;

    SELECT COALESCE(SUM(iub.quantity), 0) INTO v_available
    FROM public.inventory_unit_batches iub
    WHERE iub.unit_id = v_row.unit_id
      AND iub.branch_id = p_branch_id
      AND iub.warehouse_id = p_warehouse_id
      AND iub.quantity > 0;

    v_remaining_stock := GREATEST(v_available - v_row.stock_used, 0);
    v_cover := LEAST(v_delta, v_remaining_stock);
    v_shortage := GREATEST(v_delta - v_cover, 0);

    UPDATE pg_temp.cart_unit_need
    SET processed_qty = processed_qty + v_delta,
        stock_used = stock_used + v_cover
    WHERE unit_id = v_row.unit_id;

    IF v_shortage > 0 THEN
      IF v_unit_type <> 'manufactured' THEN
        RETURN jsonb_build_object(
          'success', false, 'error', 'INSUFFICIENT_UNIT_STOCK',
          'unit_id', v_row.unit_id, 'required', v_row.required_qty, 'available', v_available
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.inventory_unit_recipes WHERE unit_id = v_row.unit_id)
         AND NOT EXISTS (SELECT 1 FROM public.inventory_unit_recipe_units WHERE unit_id = v_row.unit_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'MANUFACTURED_UNIT_HAS_NO_RECIPE', 'unit_id', v_row.unit_id);
      END IF;

      INSERT INTO pg_temp.cart_raw_need(raw_material_id, required_qty)
      SELECT iur.raw_material_id,
             v_shortage * iur.quantity * (1 + COALESCE(iur.wastage_percent, 0) / 100.0)
      FROM public.inventory_unit_recipes iur
      WHERE iur.unit_id = v_row.unit_id
      ON CONFLICT(raw_material_id) DO UPDATE
      SET required_qty = pg_temp.cart_raw_need.required_qty + EXCLUDED.required_qty;

      INSERT INTO pg_temp.cart_unit_need(unit_id, required_qty)
      SELECT iuru.component_unit_id,
             v_shortage * iuru.quantity * (1 + COALESCE(iuru.wastage_percent, 0) / 100.0)
      FROM public.inventory_unit_recipe_units iuru
      WHERE iuru.unit_id = v_row.unit_id
      ON CONFLICT(unit_id) DO UPDATE
      SET required_qty = pg_temp.cart_unit_need.required_qty + EXCLUDED.required_qty;
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM pg_temp.cart_raw_need ORDER BY raw_material_id LOOP
    SELECT COALESCE(SUM(b.quantity), 0) INTO v_available
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = v_row.raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id
      AND b.quantity > 0;
    IF v_available + 0.0000001 < v_row.required_qty THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'INSUFFICIENT_RAW_MATERIAL_STOCK',
        'raw_material_id', v_row.raw_material_id,
        'required', v_row.required_qty, 'available', v_available
      );
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM pg_temp.cart_ready_need ORDER BY product_id LOOP
    SELECT COALESCE(SUM(ib.quantity), 0) INTO v_available
    FROM public.inventory_batches ib
    WHERE ib.product_id = v_row.product_id
      AND ib.branch_id = p_branch_id
      AND ib.warehouse_id = p_warehouse_id
      AND ib.quantity > 0;
    IF v_available + 0.0000001 < v_row.required_qty THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'INSUFFICIENT_PRODUCT_STOCK',
        'product_id', v_row.product_id,
        'required', v_row.required_qty, 'available', v_available
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'mode', 'cart_aggregate');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pos_cart_product_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_cap integer DEFAULT 100000
) RETURNS TABLE(product_id uuid, available_quantity numeric, is_available boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product record;
  v_base jsonb;
  v_check jsonb;
  v_candidate_items jsonb;
  v_low integer;
  v_high integer;
  v_mid integer;
BEGIN
  IF p_items IS NULL THEN p_items := '[]'::jsonb; END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;
  IF p_cap IS NULL OR p_cap < 1 THEN p_cap := 1; END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';
  END IF;

  v_base := public.check_pos_cart_availability(p_branch_id, p_warehouse_id, p_items);

  FOR v_product IN
    SELECT p.id FROM public.products p
    WHERE p.branch_id = p_branch_id AND p.is_active = true
    ORDER BY p.id
  LOOP
    v_low := 0;
    IF COALESCE((v_base->>'success')::boolean, false) IS TRUE THEN
      v_high := 1;
      LOOP
        v_candidate_items := p_items || jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'quantity', v_high));
        v_check := public.check_pos_cart_availability(p_branch_id, p_warehouse_id, v_candidate_items);
        EXIT WHEN COALESCE((v_check->>'success')::boolean, false) IS NOT TRUE OR v_high >= p_cap;
        v_low := v_high;
        v_high := LEAST(v_high * 2, p_cap);
        EXIT WHEN v_low = v_high;
      END LOOP;

      IF v_high = p_cap AND COALESCE((v_check->>'success')::boolean, false) IS TRUE THEN
        v_low := p_cap;
      ELSE
        WHILE v_high - v_low > 1 LOOP
          v_mid := (v_low + v_high) / 2;
          v_candidate_items := p_items || jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'quantity', v_mid));
          v_check := public.check_pos_cart_availability(p_branch_id, p_warehouse_id, v_candidate_items);
          IF COALESCE((v_check->>'success')::boolean, false) IS TRUE THEN
            v_low := v_mid;
          ELSE
            v_high := v_mid;
          END IF;
        END LOOP;
      END IF;
    END IF;

    product_id := v_product.id;
    available_quantity := v_low;
    is_available := v_low > 0;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.check_pos_cart_availability(uuid,uuid,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pos_cart_product_availability(uuid,uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_pos_cart_availability(uuid,uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_cart_product_availability(uuid,uuid,jsonb,integer) TO authenticated, service_role;
