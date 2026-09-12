-- POS availability stabilization.
--
-- Root cause proven on Production: POS users with pos.view but without
-- products.view could resolve the branch warehouse and call the availability
-- RPC, yet RLS returned zero catalog rows. A stale offline catalog then had no
-- matching authoritative availability keys and rendered "Could not verify".
--
-- This policy grants only active, same-branch catalog reads to pos.view. Product
-- management and inactive rows remain protected by their existing permissions.

DROP POLICY IF EXISTS auth_select_products ON public.products;
CREATE POLICY auth_select_products ON public.products
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (
    public.user_may_access_branch(branch_id)
    AND (
      public.can_permission('products.view')
      OR (is_active = true AND public.can_permission('pos.view'))
    )
  )
);

-- Restore the write-time branch invariant on fresh databases as well as
-- upgrades. Existing deployments may already have this trigger; recreating it
-- is idempotent and prevents new cross-branch recipe links.
CREATE OR REPLACE FUNCTION public.validate_recipe_item_branch_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_recipe_branch uuid;
  v_material_branch uuid;
BEGIN
  SELECT branch_id INTO v_recipe_branch
  FROM public.recipes
  WHERE id = NEW.recipe_id;

  SELECT branch_id INTO v_material_branch
  FROM public.raw_materials
  WHERE id = NEW.raw_material_id;

  IF v_recipe_branch IS NULL
     OR v_material_branch IS NULL
     OR v_recipe_branch <> v_material_branch THEN
    RAISE EXCEPTION 'RAW_MATERIAL_BRANCH_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_recipe_item_branch ON public.recipe_items;
DROP TRIGGER IF EXISTS trg_00_validate_recipe_item_branch ON public.recipe_items;
-- PostgreSQL fires same-kind triggers by name. Keep the invariant guard first
-- so no later compatibility trigger can silently skip an invalid row before
-- this validation runs.
CREATE TRIGGER trg_00_validate_recipe_item_branch
BEFORE INSERT OR UPDATE ON public.recipe_items
FOR EACH ROW EXECUTE FUNCTION public.validate_recipe_item_branch_match();

REVOKE ALL ON FUNCTION public.validate_recipe_item_branch_match() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_recipe_item_branch_match() TO service_role, postgres;

-- Positive raw-shortage classification hardening.
--
-- A recipe (or manufactured-unit recipe) must only consume raw materials that
-- actually belong to the product's branch. When a misconfigured recipe
-- references a raw material of another branch, the availability check used to
-- see "no branch stock for this raw" and returned INSUFFICIENT_RAW_MATERIAL_STOCK.
-- That silently classified the misconfigured product as raw-shortage-only and
-- made it auto-sellable in the POS, posting "oversold" debt batches for a raw
-- material the branch never held.
--
-- This guard returns an explicit configuration error instead. It is not part of
-- the three authoritative shortage codes, so get_pos_product_availability keeps
-- treating it as an unknown availability source: the product stays visible but
-- blocked ("unavailable for unverified inventory"), never auto-sellable.
--
-- Known limitation: modifier inventory effects that reference a foreign-branch
-- raw are validated at sale time by the deduction core, not by this guard.

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

  IF v_recipe_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.recipe_items ri
    WHERE ri.recipe_id = v_recipe_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.raw_materials rm
        WHERE rm.id = ri.raw_material_id
          AND rm.branch_id = p_branch_id
          AND rm.is_active = true
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'RAW_MATERIAL_NOT_IN_BRANCH',
      'recipe_id', v_recipe_id
    );
  END IF;

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

      IF EXISTS (
        SELECT 1
        FROM public.inventory_unit_recipes iur
        WHERE iur.unit_id = v_row.unit_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.raw_materials rm
            WHERE rm.id = iur.raw_material_id
              AND rm.branch_id = p_branch_id
              AND rm.is_active = true
          )
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'RAW_MATERIAL_NOT_IN_BRANCH',
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
    SELECT COALESCE(SUM(b.quantity), 0)
    INTO v_available
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = v_row.raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id;
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

-- Direct execution contract is unchanged: authenticated reads; the SECURITY
-- DEFINER body keeps enforcing branch/product scope through its own predicates.
REVOKE EXECUTE ON FUNCTION public.check_product_availability(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_product_availability(uuid, uuid, uuid, numeric) TO authenticated;



-- Unknown configuration is returned as a blocked row with a precise error code
-- instead of disappearing from the POS availability result. The client must
-- never treat availability_error as sellable.
DROP FUNCTION IF EXISTS public.get_pos_product_availability(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_pos_product_availability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_cap integer DEFAULT 100000
) RETURNS TABLE(product_id uuid, available_quantity numeric, is_available boolean, raw_shortage_only boolean, availability_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product record;
  v_low integer;
  v_high integer;
  v_mid integer;
  v_check jsonb;
  v_high_ok boolean;
  v_error text;
  v_source_unknown boolean;
  v_has_manufactured_unit boolean;
BEGIN
  IF p_cap IS NULL OR p_cap < 1 THEN
    p_cap := 1;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_IN_BRANCH'
      USING ERRCODE = '22023';
  END IF;

  FOR v_product IN
    SELECT p.id
    FROM public.products p
    WHERE p.branch_id = p_branch_id
      AND p.is_active = true
    ORDER BY p.id
  LOOP
    v_low := 0;
    v_high := 1;
    v_high_ok := false;
    v_source_unknown := false;
    v_error := NULL;
    v_has_manufactured_unit := false;

    SELECT EXISTS(
      SELECT 1
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu ON iu.id = pul.unit_id
      WHERE pul.product_id = v_product.id
        AND iu.branch_id = p_branch_id
        AND iu.unit_type = 'manufactured'
        AND iu.is_active = true
    ) INTO v_has_manufactured_unit;

    LOOP
      v_check := public.check_product_availability(
        v_product.id,
        p_branch_id,
        p_warehouse_id,
        v_high
      );
      v_high_ok := COALESCE((v_check->>'success')::boolean, false);

      IF NOT v_high_ok THEN
        v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY_SOURCE');
        v_source_unknown := v_error NOT IN (
          'INSUFFICIENT_PRODUCT_STOCK',
          'INSUFFICIENT_UNIT_STOCK',
          'INSUFFICIENT_RAW_MATERIAL_STOCK'
        );
        EXIT;
      END IF;

      v_low := v_high;
      EXIT WHEN v_high >= p_cap;
      v_high := LEAST(v_high * 2, p_cap);
    END LOOP;

    -- Configuration failures are authoritative blocked states. Return the row
    -- with its error code so the client never confuses it with missing data.
    IF v_source_unknown THEN
      product_id := v_product.id;
      available_quantity := 0;
      is_available := false;
      raw_shortage_only := false;
      availability_error := v_error;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_low < p_cap AND NOT v_high_ok THEN
      WHILE v_high - v_low > 1 LOOP
        v_mid := (v_low + v_high) / 2;
        v_check := public.check_product_availability(
          v_product.id,
          p_branch_id,
          p_warehouse_id,
          v_mid
        );

        IF COALESCE((v_check->>'success')::boolean, false) THEN
          v_low := v_mid;
        ELSE
          v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY_SOURCE');
          IF v_error NOT IN (
            'INSUFFICIENT_PRODUCT_STOCK',
            'INSUFFICIENT_UNIT_STOCK',
            'INSUFFICIENT_RAW_MATERIAL_STOCK'
          ) THEN
            v_source_unknown := true;
          END IF;
          v_high := v_mid;
        END IF;
      END LOOP;
    END IF;

    IF v_source_unknown THEN
      product_id := v_product.id;
      available_quantity := 0;
      is_available := false;
      raw_shortage_only := false;
      availability_error := v_error;
      RETURN NEXT;
      CONTINUE;
    END IF;

    product_id := v_product.id;
    available_quantity := v_low;
    is_available := v_low > 0;
    raw_shortage_only := (NOT v_high_ok)
      AND COALESCE(v_error, '') = 'INSUFFICIENT_RAW_MATERIAL_STOCK'
      AND NOT v_has_manufactured_unit;
    availability_error := NULL;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_product_availability(uuid, uuid, integer) TO authenticated, service_role;
