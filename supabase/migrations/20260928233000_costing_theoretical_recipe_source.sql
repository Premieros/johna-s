-- Hotfix: stop exposing the retired product_components BOM as the current theoretical product cost.
-- Canonical theoretical product cost is the current recipe/raw-material model, including linked manufactured groups.
-- Historical COGS, POS inventory deduction, printing, KDS, payment and shifts are intentionally unchanged.

CREATE OR REPLACE FUNCTION public._product_bom_cost(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(public._product_recipe_cost(p_product_id, p_branch_id), 0)
$function$;

REVOKE ALL ON FUNCTION public._product_bom_cost(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._product_bom_cost(uuid, uuid) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.get_costing_overview(
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  barcode text,
  sku text,
  category_name text,
  product_type text,
  sale_price numeric,
  unit_cost numeric,
  theoretical_cost numeric,
  actual_cost numeric,
  component_count bigint,
  recipe_item_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT public.is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch
    FROM public.users u
    WHERE u.id = auth.uid();
    v_scope := v_user_branch;
  ELSE
    v_scope := p_branch_id;
  END IF;

  RETURN QUERY
  WITH scoped_products AS MATERIALIZED (
    SELECT p.id, p.name, p.barcode, p.sku, p.category_id, p.branch_id, p.product_type, p.sale_price
    FROM public.products p
    WHERE p.is_active = true
      AND (v_scope IS NULL OR p.branch_id = v_scope)
  ),
  scoped_branches AS MATERIALIZED (
    SELECT DISTINCT sp.branch_id
    FROM scoped_products sp
    WHERE sp.branch_id IS NOT NULL
  ),
  scoped_raw_materials AS MATERIALIZED (
    SELECT rm.id, rm.branch_id, rm.default_cost
    FROM public.raw_materials rm
    JOIN scoped_branches sb ON sb.branch_id = rm.branch_id
  ),
  events AS MATERIALIZED (
    SELECT e.*
    FROM public._raw_cost_events_for_costing(NULL, v_scope) e
    JOIN scoped_branches sb ON sb.branch_id = e.branch_id
  ),
  ranked AS MATERIALIZED (
    SELECT e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.raw_material_id, e.branch_id
        ORDER BY e.priced_at DESC NULLS LAST, e.source_rank, e.reference_number DESC NULLS LAST, e.event_id DESC
      ) AS rn
    FROM events e
  ),
  inventory_latest AS MATERIALIZED (
    SELECT DISTINCT ON (rmi.raw_material_id, rmi.branch_id)
      rmi.raw_material_id, rmi.branch_id, rmi.avg_cost::numeric AS unit_cost
    FROM public.raw_material_inventory rmi
    JOIN scoped_raw_materials srm ON srm.id = rmi.raw_material_id AND srm.branch_id = rmi.branch_id
    WHERE COALESCE(rmi.avg_cost, 0) > 0
    ORDER BY rmi.raw_material_id, rmi.branch_id, rmi.updated_at DESC NULLS LAST, rmi.id DESC
  ),
  batch_average AS MATERIALIZED (
    SELECT b.raw_material_id, b.branch_id,
      NULLIF(SUM(b.quantity * COALESCE(b.unit_cost, 0)) / NULLIF(SUM(b.quantity), 0), 0)::numeric AS unit_cost
    FROM public.raw_material_batches b
    JOIN scoped_raw_materials srm ON srm.id = b.raw_material_id AND srm.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.raw_material_id, b.branch_id
  ),
  raw_costs AS MATERIALIZED (
    SELECT srm.id AS raw_material_id, srm.branch_id,
      COALESCE(r1.unit_cost, inv.unit_cost, ba.unit_cost, srm.default_cost, 0)::numeric AS unit_cost
    FROM scoped_raw_materials srm
    LEFT JOIN ranked r1 ON r1.raw_material_id = srm.id AND r1.branch_id = srm.branch_id AND r1.rn = 1
    LEFT JOIN inventory_latest inv ON inv.raw_material_id = srm.id AND inv.branch_id = srm.branch_id
    LEFT JOIN batch_average ba ON ba.raw_material_id = srm.id AND ba.branch_id = srm.branch_id
  ),
  product_wavg AS MATERIALIZED (
    SELECT b.product_id, b.branch_id,
      CASE WHEN SUM(b.quantity) > 0
        THEN round(SUM(b.quantity * b.unit_cost) / SUM(b.quantity), 2)
        ELSE 0
      END::numeric AS unit_cost
    FROM public.inventory_batches b
    JOIN scoped_branches sb ON sb.branch_id = b.branch_id
    WHERE b.quantity > 0
    GROUP BY b.product_id, b.branch_id
  ),
  component_counts AS MATERIALIZED (
    SELECT pc.product_id, COUNT(*)::bigint AS component_count
    FROM public.product_components pc
    JOIN scoped_products sp ON sp.id = pc.product_id
    GROUP BY pc.product_id
  ),
  recipe_lines AS MATERIALIZED (
    SELECT
      r.product_id,
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.recipes r
    JOIN scoped_products sp ON sp.id = r.product_id
    JOIN public.recipe_items ri ON ri.recipe_id = r.id
    WHERE v_scope IS NULL OR r.branch_id = v_scope

    UNION ALL

    SELECT
      pul.product_id,
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.product_unit_links pul
    JOIN scoped_products sp ON sp.id = pul.product_id
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
     AND (sp.branch_id IS NULL OR iu.branch_id = sp.branch_id)
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
  ),
  recipe_costs AS MATERIALIZED (
    SELECT
      rl.product_id,
      round(SUM(
        rl.quantity
        * (1 + rl.wastage_percent / 100.0)
        * COALESCE(rc.unit_cost, 0)
      ), 2)::numeric AS cost
    FROM recipe_lines rl
    LEFT JOIN raw_costs rc ON rc.raw_material_id = rl.raw_material_id
    GROUP BY rl.product_id
  ),
  recipe_counts AS MATERIALIZED (
    SELECT rl.product_id, COUNT(*)::bigint AS recipe_item_count
    FROM recipe_lines rl
    GROUP BY rl.product_id
  )
  SELECT
    sp.id,
    COALESCE(NULLIF(btrim(sp.name), ''), 'Product')::text,
    sp.barcode,
    sp.sku,
    c.name,
    COALESCE(sp.product_type, 'ready')::text,
    COALESCE(sp.sale_price, 0)::numeric(12,2),
    COALESCE(pw.unit_cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(cc.component_count, 0)::bigint,
    COALESCE(rct.recipe_item_count, 0)::bigint
  FROM scoped_products sp
  LEFT JOIN public.categories c ON c.id = sp.category_id
  LEFT JOIN product_wavg pw ON pw.product_id = sp.id AND pw.branch_id = sp.branch_id
  LEFT JOIN recipe_costs rc ON rc.product_id = sp.id
  LEFT JOIN component_counts cc ON cc.product_id = sp.id
  LEFT JOIN recipe_counts rct ON rct.product_id = sp.id
  ORDER BY sp.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_costing_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_costing_overview(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
