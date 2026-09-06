-- Regression closure: purchase/sale document numbering after generic serial hardening
-- and POS availability failures caused by duplicate component rows.
--
-- Security invariant: next_document_number(text) remains non-executable by
-- authenticated/anon clients. Narrow wrappers enforce the effective permission
-- before delegating to the generic sequence helper.

CREATE OR REPLACE FUNCTION public.next_purchase_document_number()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.can_permission('purchases.manage') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ALLOWED',
      'detail', 'Creating purchases requires the purchases.manage permission.'
    );
  END IF;

  RETURN public.next_document_number('purchase');
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_sale_document_number()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ALLOWED',
      'detail', 'Taking payment requires the pos.payment.take permission.'
    );
  END IF;

  RETURN public.next_document_number('sale');
END;
$function$;

REVOKE ALL ON FUNCTION public.next_purchase_document_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_sale_document_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_purchase_document_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_sale_document_number() FROM anon;
GRANT EXECUTE ON FUNCTION public.next_purchase_document_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_sale_document_number() TO authenticated;

-- Preserve the security boundary introduced by the serial hardening pass.
REVOKE EXECUTE ON FUNCTION public.next_document_number(text) FROM PUBLIC, anon, authenticated;

-- Duplicate-safe availability calculation.
-- Every INSERT ... ON CONFLICT source is grouped by its conflict key first.
-- This preserves the SUM of duplicate recipe/link quantities instead of throwing
-- PostgreSQL 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time").
CREATE OR REPLACE FUNCTION public.check_product_availability(
  p_product_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_recipe_id uuid;
  v_yield numeric := 1;
  v_link_count integer := 0;
  v_direct_raw_count integer := 0;
  v_row record;
  v_delta numeric;
  v_available numeric;
  v_remaining_stock numeric;
  v_cover numeric;
  v_shortage numeric;
  v_unit_type text;
  v_iter integer := 0;
  v_ready numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH');
  END IF;

  SELECT COALESCE(SUM(ib.quantity), 0)
  INTO v_ready
  FROM public.inventory_batches ib
  WHERE ib.product_id = p_product_id
    AND ib.branch_id = p_branch_id
    AND ib.warehouse_id = p_warehouse_id
    AND ib.quantity > 0;

  IF v_ready >= p_quantity THEN
    RETURN jsonb_build_object(
      'success', true,
      'required', p_quantity,
      'available', v_ready,
      'mode', 'ready_product'
    );
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.avail_raw_need(
    raw_material_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.avail_unit_need(
    unit_id uuid PRIMARY KEY,
    required_qty numeric NOT NULL DEFAULT 0,
    processed_qty numeric NOT NULL DEFAULT 0,
    stock_used numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE pg_temp.avail_raw_need;
  TRUNCATE pg_temp.avail_unit_need;

  INSERT INTO pg_temp.avail_unit_need(unit_id, required_qty)
  SELECT grouped.unit_id, grouped.required_qty
  FROM (
    SELECT pul.unit_id, SUM(p_quantity * pul.quantity) AS required_qty
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id = pul.unit_id
    WHERE pul.product_id = p_product_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true
    GROUP BY pul.unit_id
  ) grouped
  ON CONFLICT(unit_id) DO UPDATE
  SET required_qty = pg_temp.avail_unit_need.required_qty + EXCLUDED.required_qty;
  GET DIAGNOSTICS v_link_count = ROW_COUNT;

  SELECT r.id, COALESCE(NULLIF(r.yield_quantity, 0), 1)
  INTO v_recipe_id, v_yield
  FROM public.recipes r
  WHERE r.product_id = p_product_id
    AND r.branch_id = p_branch_id
    AND COALESCE(r.is_active, true) = true
  ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC
  LIMIT 1;

  IF v_recipe_id IS NOT NULL THEN
    INSERT INTO pg_temp.avail_raw_need(raw_material_id, required_qty)
    SELECT grouped.raw_material_id, grouped.required_qty
    FROM (
      SELECT
        ri.raw_material_id,
        SUM(p_quantity * (ri.quantity / v_yield)) AS required_qty
      FROM public.recipe_items ri
      JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = v_recipe_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.product_unit_links pul
          JOIN public.inventory_units iu ON iu.id = pul.unit_id
          WHERE pul.product_id = p_product_id
            AND iu.branch_id = p_branch_id
            AND iu.is_active = true
            AND regexp_replace(lower(btrim(iu.name)), '[ .]+$', '', 'g') =
                regexp_replace(lower(btrim(rm.name)), '[ .]+$', '', 'g')
        )
      GROUP BY ri.raw_material_id
    ) grouped
    ON CONFLICT(raw_material_id) DO UPDATE
    SET required_qty = pg_temp.avail_raw_need.required_qty + EXCLUDED.required_qty;
    GET DIAGNOSTICS v_direct_raw_count = ROW_COUNT;
  END IF;

  IF v_link_count = 0 AND v_direct_raw_count = 0 THEN
    RETURN jsonb_build_object(
      'success', v_ready >= p_quantity,
      'error', CASE WHEN v_ready >= p_quantity THEN NULL ELSE 'INSUFFICIENT_PRODUCT_STOCK' END,
      'required', p_quantity,
      'available', v_ready,
      'mode', 'ready_product'
    );
  END IF;

  LOOP
    SELECT *
    INTO v_row
    FROM pg_temp.avail_unit_need
    WHERE required_qty > processed_qty + 0.0000001
    ORDER BY unit_id
    LIMIT 1;
    EXIT WHEN NOT FOUND;

    v_iter := v_iter + 1;
    IF v_iter > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'UNIT_RECIPE_CYCLE_OR_TOO_DEEP');
    END IF;

    v_delta := v_row.required_qty - v_row.processed_qty;

    SELECT iu.unit_type
    INTO v_unit_type
    FROM public.inventory_units iu
    WHERE iu.id = v_row.unit_id
      AND iu.branch_id = p_branch_id
      AND iu.is_active = true;

    IF v_unit_type IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INVENTORY_UNIT_NOT_AVAILABLE',
        'unit_id', v_row.unit_id
      );
    END IF;

    SELECT COALESCE(SUM(iub.quantity), 0)
    INTO v_available
    FROM public.inventory_unit_batches iub
    WHERE iub.unit_id = v_row.unit_id
      AND iub.branch_id = p_branch_id
      AND iub.warehouse_id = p_warehouse_id
      AND iub.quantity > 0;

    v_remaining_stock := GREATEST(v_available - v_row.stock_used, 0);
    v_cover := LEAST(v_delta, v_remaining_stock);
    v_shortage := GREATEST(v_delta - v_cover, 0);

    UPDATE pg_temp.avail_unit_need
    SET processed_qty = processed_qty + v_delta,
        stock_used = stock_used + v_cover
    WHERE unit_id = v_row.unit_id;

    IF v_shortage > 0 THEN
      IF v_unit_type <> 'manufactured' THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'INSUFFICIENT_UNIT_STOCK',
          'unit_id', v_row.unit_id,
          'required', v_row.required_qty,
          'available', v_available
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.inventory_unit_recipes WHERE unit_id = v_row.unit_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.inventory_unit_recipe_units WHERE unit_id = v_row.unit_id
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'MANUFACTURED_UNIT_HAS_NO_RECIPE',
          'unit_id', v_row.unit_id
        );
      END IF;

      INSERT INTO pg_temp.avail_raw_need(raw_material_id, required_qty)
      SELECT grouped.raw_material_id, grouped.required_qty
      FROM (
        SELECT
          iur.raw_material_id,
          SUM(v_shortage * iur.quantity * (1 + COALESCE(iur.wastage_percent, 0) / 100.0)) AS required_qty
        FROM public.inventory_unit_recipes iur
        WHERE iur.unit_id = v_row.unit_id
        GROUP BY iur.raw_material_id
      ) grouped
      ON CONFLICT(raw_material_id) DO UPDATE
      SET required_qty = pg_temp.avail_raw_need.required_qty + EXCLUDED.required_qty;

      INSERT INTO pg_temp.avail_unit_need(unit_id, required_qty)
      SELECT grouped.component_unit_id, grouped.required_qty
      FROM (
        SELECT
          iuru.component_unit_id,
          SUM(v_shortage * iuru.quantity * (1 + COALESCE(iuru.wastage_percent, 0) / 100.0)) AS required_qty
        FROM public.inventory_unit_recipe_units iuru
        WHERE iuru.unit_id = v_row.unit_id
        GROUP BY iuru.component_unit_id
      ) grouped
      ON CONFLICT(unit_id) DO UPDATE
      SET required_qty = pg_temp.avail_unit_need.required_qty + EXCLUDED.required_qty;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT * FROM pg_temp.avail_raw_need ORDER BY raw_material_id
  LOOP
    SELECT COALESCE(rmi.quantity, 0)
    INTO v_available
    FROM public.raw_material_inventory rmi
    WHERE rmi.raw_material_id = v_row.raw_material_id
      AND rmi.branch_id = p_branch_id;

    v_available := COALESCE(v_available, 0);
    IF v_available + 0.0000001 < v_row.required_qty THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'INSUFFICIENT_RAW_MATERIAL_STOCK',
        'raw_material_id', v_row.raw_material_id,
        'required', v_row.required_qty,
        'available', v_available
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'mode', 'recipe', 'quantity', p_quantity);
END;
$function$;

-- Keep direct execution aligned with the existing contract: availability is an
-- authenticated read, while its SECURITY DEFINER body enforces branch access
-- through its callers and product/branch predicates.
REVOKE EXECUTE ON FUNCTION public.check_product_availability(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_product_availability(uuid, uuid, uuid, numeric) TO authenticated;
