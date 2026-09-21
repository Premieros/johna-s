-- Follow-up hardening for POS sellability:
-- validate configuration independently from stock quantity, then perform only one
-- availability probe. This prevents an ordinary stock shortage on one dependency
-- from hiding a malformed later dependency.
--
-- The prior sellability migration may already exist in deployed environments.
-- This migration is forward-only and replaces the functions safely.

CREATE OR REPLACE FUNCTION public.pos_product_configuration_error(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_error text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
  ) THEN
    RETURN 'PRODUCT_NOT_IN_BRANCH';
  END IF;

  WITH RECURSIVE
  latest_recipe AS (
    SELECT r.id
    FROM public.recipes r
    WHERE r.product_id = p_product_id
      AND r.branch_id = p_branch_id
      AND COALESCE(r.is_active, true) = true
    ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC
    LIMIT 1
  ),
  unit_tree(unit_id, path, cycle, depth) AS (
    SELECT
      pul.unit_id,
      ARRAY[pul.unit_id]::uuid[],
      false,
      1
    FROM public.product_unit_links pul
    WHERE pul.product_id = p_product_id

    UNION ALL

    SELECT
      iuru.component_unit_id,
      ut.path || iuru.component_unit_id,
      iuru.component_unit_id = ANY(ut.path),
      ut.depth + 1
    FROM unit_tree ut
    JOIN public.inventory_unit_recipe_units iuru
      ON iuru.unit_id = ut.unit_id
    WHERE NOT ut.cycle
      AND ut.depth < 100
  ),
  unit_set AS (
    SELECT DISTINCT unit_id
    FROM unit_tree
  )
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.product_unit_links pul
      WHERE pul.product_id = p_product_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.inventory_units iu
          WHERE iu.id = pul.unit_id
            AND iu.branch_id = p_branch_id
            AND iu.is_active = true
        )
    ) THEN 'INVENTORY_UNIT_NOT_AVAILABLE'

    WHEN EXISTS (
      SELECT 1
      FROM latest_recipe lr
      JOIN public.recipe_items ri ON ri.recipe_id = lr.id
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.raw_materials rm
        WHERE rm.id = ri.raw_material_id
          AND rm.branch_id = p_branch_id
          AND rm.is_active = true
      )
    ) THEN 'RAW_MATERIAL_NOT_IN_BRANCH'

    WHEN EXISTS (
      SELECT 1
      FROM unit_tree ut
      WHERE ut.cycle
         OR (
           ut.depth >= 100
           AND EXISTS (
             SELECT 1
             FROM public.inventory_unit_recipe_units next_edge
             WHERE next_edge.unit_id = ut.unit_id
           )
         )
    ) THEN 'UNIT_RECIPE_CYCLE_OR_TOO_DEEP'

    WHEN EXISTS (
      SELECT 1
      FROM unit_set us
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.inventory_units iu
        WHERE iu.id = us.unit_id
          AND iu.branch_id = p_branch_id
          AND iu.is_active = true
      )
    ) THEN 'INVENTORY_UNIT_NOT_AVAILABLE'

    WHEN EXISTS (
      SELECT 1
      FROM unit_set us
      JOIN public.inventory_units iu
        ON iu.id = us.unit_id
       AND iu.branch_id = p_branch_id
       AND iu.is_active = true
      WHERE iu.unit_type = 'manufactured'
        AND NOT EXISTS (
          SELECT 1
          FROM public.inventory_unit_recipes iur
          WHERE iur.unit_id = us.unit_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.inventory_unit_recipe_units iuru
          WHERE iuru.unit_id = us.unit_id
        )
    ) THEN 'MANUFACTURED_UNIT_HAS_NO_RECIPE'

    WHEN EXISTS (
      SELECT 1
      FROM unit_set us
      JOIN public.inventory_unit_recipes iur
        ON iur.unit_id = us.unit_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.raw_materials rm
        WHERE rm.id = iur.raw_material_id
          AND rm.branch_id = p_branch_id
          AND rm.is_active = true
      )
    ) THEN 'RAW_MATERIAL_NOT_IN_BRANCH'

    ELSE NULL
  END
  INTO v_error;

  RETURN v_error;
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_product_configuration_error(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_product_configuration_error(uuid, uuid) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.get_pos_product_sellability(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_probe_quantity numeric DEFAULT 100000
)
RETURNS TABLE(
  product_id uuid,
  is_sellable boolean,
  raw_shortage_only boolean,
  availability_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product record;
  v_check jsonb;
  v_error text;
BEGIN
  IF p_probe_quantity IS NULL OR p_probe_quantity <= 0 THEN
    p_probe_quantity := 100000;
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
    -- Configuration is validated independently from quantity/stock. This keeps
    -- malformed recipes and unit graphs blocking even when another dependency
    -- would fail earlier only because of stock.
    v_error := public.pos_product_configuration_error(v_product.id, p_branch_id);
    IF v_error IS NOT NULL THEN
      product_id := v_product.id;
      is_sellable := false;
      raw_shortage_only := false;
      availability_error := v_error;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_check := public.check_product_availability(
      v_product.id,
      p_branch_id,
      p_warehouse_id,
      p_probe_quantity
    );

    IF COALESCE((v_check->>'success')::boolean, false) THEN
      product_id := v_product.id;
      is_sellable := true;
      raw_shortage_only := false;
      availability_error := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_error := COALESCE(v_check->>'error', 'UNKNOWN_AVAILABILITY_SOURCE');

    -- Quantity is not a client-side saleability gate in the current POS
    -- contract. Physical deduction/server validation remains authoritative.
    IF v_error IN (
      'INSUFFICIENT_PRODUCT_STOCK',
      'INSUFFICIENT_UNIT_STOCK',
      'INSUFFICIENT_RAW_MATERIAL_STOCK'
    ) THEN
      product_id := v_product.id;
      is_sellable := true;
      raw_shortage_only := v_error = 'INSUFFICIENT_RAW_MATERIAL_STOCK';
      availability_error := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    product_id := v_product.id;
    is_sellable := false;
    raw_shortage_only := false;
    availability_error := v_error;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.pos_product_configuration_error(uuid, uuid)
IS 'Internal stock-independent POS product configuration validator.';

COMMENT ON FUNCTION public.get_pos_product_sellability(uuid, uuid, numeric)
IS 'POS catalog sellability/configuration probe. Configuration validation is stock-independent; quantity shortages remain informational.';
