-- Canonical component resolver for the manufacturing-retirement program.
-- Phase 2 is additive only: existing recipe/unit tables remain untouched.
-- The resolver interprets:
--   recipes/recipe_items                    = direct product raw components
--   product_unit_links + inventory_units   = reusable named component groups
--   inventory_unit_recipes                 = group raw components
--   inventory_unit_recipe_units            = nested reusable groups
-- It does NOT manufacture or mutate inventory.

CREATE OR REPLACE FUNCTION public.resolve_product_raw_components(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS TABLE(
  raw_material_id uuid,
  raw_name text,
  quantity_per_sale numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cycle boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.branch_id = p_branch_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_IN_BRANCH';
  END IF;

  -- Reject a linked reusable group that belongs to another branch.
  IF EXISTS (
    SELECT 1
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu ON iu.id = pul.unit_id
    WHERE pul.product_id = p_product_id
      AND iu.branch_id IS DISTINCT FROM p_branch_id
  ) THEN
    RAISE EXCEPTION 'COMPONENT_GROUP_NOT_IN_BRANCH';
  END IF;

  -- Detect cycles before flattening nested reusable groups.
  WITH RECURSIVE walk(unit_id, path, cycle) AS (
    SELECT
      pul.unit_id,
      ARRAY[pul.unit_id]::uuid[],
      false
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.branch_id = p_branch_id
     AND iu.is_active = true
    WHERE pul.product_id = p_product_id

    UNION ALL

    SELECT
      rel.component_unit_id,
      w.path || rel.component_unit_id,
      rel.component_unit_id = ANY(w.path)
    FROM walk w
    JOIN public.inventory_unit_recipe_units rel
      ON rel.unit_id = w.unit_id
    WHERE NOT w.cycle
  )
  SELECT COALESCE(bool_or(cycle), false)
  INTO v_cycle
  FROM walk;

  IF v_cycle THEN
    RAISE EXCEPTION 'COMPONENT_GROUP_CYCLE';
  END IF;

  -- Direct product recipe rows must stay inside the product branch.
  IF EXISTS (
    WITH latest_recipe AS (
      SELECT r.id
      FROM public.recipes r
      WHERE r.product_id = p_product_id
        AND r.branch_id = p_branch_id
        AND COALESCE(r.is_active, true) = true
      ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC, r.id DESC
      LIMIT 1
    )
    SELECT 1
    FROM latest_recipe lr
    JOIN public.recipe_items ri ON ri.recipe_id = lr.id
    JOIN public.raw_materials rm ON rm.id = ri.raw_material_id
    WHERE rm.branch_id <> p_branch_id
  ) THEN
    RAISE EXCEPTION 'RAW_MATERIAL_NOT_IN_BRANCH';
  END IF;

  -- Reusable-group raw rows and nested groups must also stay in branch.
  IF EXISTS (
    WITH RECURSIVE unit_walk(unit_id, path) AS (
      SELECT
        pul.unit_id,
        ARRAY[pul.unit_id]::uuid[]
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu
        ON iu.id = pul.unit_id
       AND iu.branch_id = p_branch_id
       AND iu.is_active = true
      WHERE pul.product_id = p_product_id

      UNION ALL

      SELECT
        rel.component_unit_id,
        w.path || rel.component_unit_id
      FROM unit_walk w
      JOIN public.inventory_unit_recipe_units rel
        ON rel.unit_id = w.unit_id
      WHERE NOT rel.component_unit_id = ANY(w.path)
    )
    SELECT 1
    FROM unit_walk w
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = w.unit_id
    JOIN public.raw_materials rm ON rm.id = iur.raw_material_id
    WHERE rm.branch_id <> p_branch_id
  ) THEN
    RAISE EXCEPTION 'RAW_MATERIAL_NOT_IN_BRANCH';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  latest_recipe AS (
    SELECT
      r.id,
      COALESCE(NULLIF(r.yield_quantity, 0), 1)::numeric AS yield_quantity
    FROM public.recipes r
    WHERE r.product_id = p_product_id
      AND r.branch_id = p_branch_id
      AND COALESCE(r.is_active, true) = true
    ORDER BY COALESCE(r.version, 1) DESC, r.created_at DESC, r.id DESC
    LIMIT 1
  ),
  unit_walk(unit_id, multiplier, path) AS (
    SELECT
      pul.unit_id,
      pul.quantity::numeric AS multiplier,
      ARRAY[pul.unit_id]::uuid[]
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.branch_id = p_branch_id
     AND iu.is_active = true
    WHERE pul.product_id = p_product_id

    UNION ALL

    SELECT
      rel.component_unit_id,
      (
        w.multiplier
        * rel.quantity
        * (1 + COALESCE(rel.wastage_percent, 0) / 100.0)
      )::numeric,
      w.path || rel.component_unit_id
    FROM unit_walk w
    JOIN public.inventory_unit_recipe_units rel
      ON rel.unit_id = w.unit_id
    JOIN public.inventory_units child
      ON child.id = rel.component_unit_id
     AND child.branch_id = p_branch_id
     AND child.is_active = true
    WHERE NOT rel.component_unit_id = ANY(w.path)
  ),
  direct_raw AS (
    SELECT
      ri.raw_material_id,
      rm.name AS raw_name,
      SUM(ri.quantity / lr.yield_quantity)::numeric AS quantity_per_sale
    FROM latest_recipe lr
    JOIN public.recipe_items ri ON ri.recipe_id = lr.id
    JOIN public.raw_materials rm
      ON rm.id = ri.raw_material_id
     AND rm.branch_id = p_branch_id
     AND rm.is_active = true
    WHERE NOT EXISTS (
      -- Compatibility bridge for the old "manufactured raw placeholder":
      -- if the product links a named reusable group with the same normalized
      -- name, the placeholder row is replaced by the group's flattened raws.
      SELECT 1
      FROM public.product_unit_links pul
      JOIN public.inventory_units iu
        ON iu.id = pul.unit_id
       AND iu.branch_id = p_branch_id
       AND iu.is_active = true
      WHERE pul.product_id = p_product_id
        AND regexp_replace(lower(btrim(iu.name)), '[ .]+$', '', 'g')
            = regexp_replace(lower(btrim(rm.name)), '[ .]+$', '', 'g')
    )
    GROUP BY ri.raw_material_id, rm.name
  ),
  group_raw AS (
    SELECT
      iur.raw_material_id,
      rm.name AS raw_name,
      SUM(
        uw.multiplier
        * iur.quantity
        * (1 + COALESCE(iur.wastage_percent, 0) / 100.0)
      )::numeric AS quantity_per_sale
    FROM unit_walk uw
    JOIN public.inventory_unit_recipes iur
      ON iur.unit_id = uw.unit_id
    JOIN public.raw_materials rm
      ON rm.id = iur.raw_material_id
     AND rm.branch_id = p_branch_id
     AND rm.is_active = true
    GROUP BY iur.raw_material_id, rm.name
  ),
  combined AS (
    SELECT * FROM direct_raw
    UNION ALL
    SELECT * FROM group_raw
  )
  SELECT
    c.raw_material_id,
    MAX(c.raw_name)::text AS raw_name,
    SUM(c.quantity_per_sale)::numeric AS quantity_per_sale
  FROM combined c
  GROUP BY c.raw_material_id
  HAVING SUM(c.quantity_per_sale) <> 0
  ORDER BY MAX(c.raw_name), c.raw_material_id;
END;
$function$;

COMMENT ON FUNCTION public.resolve_product_raw_components(uuid, uuid)
IS 'Canonical Phase-2 resolver: flattens product direct raws and reusable/nested component groups without manufacturing or inventory mutation.';

REVOKE ALL ON FUNCTION public.resolve_product_raw_components(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_product_raw_components(uuid, uuid)
  TO service_role, postgres;
