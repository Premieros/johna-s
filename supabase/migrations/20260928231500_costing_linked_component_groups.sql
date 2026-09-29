-- Include reusable manufactured component-group raw materials in product costing.
-- Operational inventory deduction/printing/KDS behavior is intentionally unchanged.

CREATE OR REPLACE FUNCTION public._product_recipe_cost(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH raw_lines AS (
    SELECT
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.recipe_items ri
    JOIN public.recipes r ON r.id = ri.recipe_id
    WHERE r.product_id = p_product_id
      AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)

    UNION ALL

    SELECT
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
    WHERE pul.product_id = p_product_id
      AND (p_branch_id IS NULL OR iu.branch_id = p_branch_id)
  )
  SELECT COALESCE(round(SUM(
    rl.quantity
    * (1 + rl.wastage_percent / 100.0)
    * COALESCE(public._raw_cost_for_costing(rl.raw_material_id, p_branch_id), 0)
  ), 2), 0)
  FROM raw_lines rl
$function$;

REVOKE ALL ON FUNCTION public._product_recipe_cost(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._product_recipe_cost(uuid, uuid) TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.get_product_costing_detail(
  p_product_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scope uuid;
  v_row record;
  v_components jsonb;
  v_recipe jsonb;
  v_history jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('reports.costing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT
    p.id, p.name, p.barcode, p.sku, p.branch_id,
    COALESCE(p.sale_price, 0) AS sale_price,
    COALESCE(public._product_wavg_cost(p.id, p.branch_id), 0) AS unit_cost,
    COALESCE(public._product_bom_cost(p.id, p.branch_id), 0) AS theoretical_cost,
    COALESCE(public._product_recipe_cost(p.id, p.branch_id), 0) AS actual_cost,
    (SELECT COUNT(*) FROM public.product_components pc WHERE pc.product_id = p.id) AS component_count,
    (
      SELECT COUNT(*)
      FROM (
        SELECT ri.id
        FROM public.recipe_items ri
        JOIN public.recipes r ON r.id = ri.recipe_id
        WHERE r.product_id = p.id

        UNION ALL

        SELECT iur.id
        FROM public.product_unit_links pul
        JOIN public.inventory_units iu
          ON iu.id = pul.unit_id
         AND iu.unit_type = 'manufactured'
         AND iu.is_active = true
        JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
        WHERE pul.product_id = p.id
          AND (p.branch_id IS NULL OR iu.branch_id = p.branch_id)
      ) q
    ) AS recipe_item_count
  INTO v_row
  FROM public.products p
  WHERE p.id = p_product_id
    AND public.user_may_access_branch(p.branch_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id);

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
  END IF;

  v_scope := v_row.branch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'component_product_id', cp.id,
    'component_name', COALESCE(NULLIF(btrim(cp.name), ''), 'Component'),
    'quantity', pc.quantity,
    'unit_cost', COALESCE(public._product_wavg_cost(pc.component_product_id, v_scope), 0),
    'line_cost', round(pc.quantity * COALESCE(public._product_wavg_cost(pc.component_product_id, v_scope), 0), 2)
  ) ORDER BY cp.name), '[]'::jsonb)
  INTO v_components
  FROM public.product_components pc
  JOIN public.products cp ON cp.id = pc.component_product_id
  WHERE pc.product_id = p_product_id;

  WITH raw_lines AS (
    SELECT
      ri.raw_material_id,
      ri.quantity::numeric AS quantity,
      COALESCE(ri.wastage_percent, 0)::numeric AS wastage_percent,
      NULL::uuid AS component_group_id,
      NULL::text AS component_group_name,
      NULL::numeric AS component_group_quantity
    FROM public.recipe_items ri
    JOIN public.recipes r ON r.id = ri.recipe_id
    WHERE r.product_id = p_product_id
      AND (v_scope IS NULL OR r.branch_id = v_scope)

    UNION ALL

    SELECT
      iur.raw_material_id,
      (pul.quantity * iur.quantity)::numeric AS quantity,
      COALESCE(iur.wastage_percent, 0)::numeric AS wastage_percent,
      iu.id AS component_group_id,
      iu.name::text AS component_group_name,
      pul.quantity::numeric AS component_group_quantity
    FROM public.product_unit_links pul
    JOIN public.inventory_units iu
      ON iu.id = pul.unit_id
     AND iu.unit_type = 'manufactured'
     AND iu.is_active = true
    JOIN public.inventory_unit_recipes iur ON iur.unit_id = iu.id
    WHERE pul.product_id = p_product_id
      AND (v_scope IS NULL OR iu.branch_id = v_scope)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'raw_material_id', rm.id,
    'raw_material_name', COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
    'quantity', rl.quantity,
    'wastage_percent', rl.wastage_percent,
    'unit_cost', COALESCE((ctx.context->>'unit_cost')::numeric, 0),
    'line_cost', round(
      rl.quantity * (1 + COALESCE(rl.wastage_percent, 0) / 100.0)
      * COALESCE((ctx.context->>'unit_cost')::numeric, 0),
      2
    ),
    'cost_source', ctx.context->>'source',
    'cost_priced_at', ctx.context->>'priced_at',
    'cost_reference', ctx.context->>'reference_number',
    'cost_detail', ctx.context->>'detail',
    'component_group_id', rl.component_group_id,
    'component_group_name', rl.component_group_name,
    'component_group_quantity', rl.component_group_quantity
  ) ORDER BY rl.component_group_name NULLS FIRST, rm.name), '[]'::jsonb)
  INTO v_recipe
  FROM raw_lines rl
  JOIN public.raw_materials rm ON rm.id = rl.raw_material_id
  CROSS JOIN LATERAL (
    SELECT public._raw_cost_context_for_costing(rl.raw_material_id, v_scope) AS context
  ) ctx;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ch.id,
    'old_cost', ch.old_cost,
    'new_cost', ch.new_cost,
    'changed_at', ch.changed_at,
    'changed_by', COALESCE(NULLIF(btrim(u.username), ''), u.full_name, u.email, ''),
    'source', ch.source
  ) ORDER BY ch.changed_at DESC), '[]'::jsonb)
  INTO v_history
  FROM public.product_cost_history ch
  LEFT JOIN public.users u ON u.id = ch.changed_by
  WHERE ch.product_id = p_product_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_row.id,
    'product_name', v_row.name,
    'barcode', v_row.barcode,
    'sku', v_row.sku,
    'sale_price', v_row.sale_price,
    'unit_cost', v_row.unit_cost,
    'theoretical_cost', v_row.theoretical_cost,
    'actual_cost', v_row.actual_cost,
    'component_count', v_row.component_count,
    'recipe_item_count', v_row.recipe_item_count,
    'components', v_components,
    'recipe_items', v_recipe,
    'history', v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_costing_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_costing_detail(uuid, uuid) TO authenticated, service_role;


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
  bom_costs AS MATERIALIZED (
    SELECT pc.product_id,
      round(SUM(pc.quantity * COALESCE(cw.unit_cost, 0)), 2)::numeric AS cost,
      COUNT(*)::bigint AS component_count
    FROM public.product_components pc
    JOIN scoped_products sp ON sp.id = pc.product_id
    LEFT JOIN product_wavg cw ON cw.product_id = pc.component_product_id AND cw.branch_id = sp.branch_id
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
    COALESCE(bc.cost, 0)::numeric(12,2),
    COALESCE(rc.cost, 0)::numeric(12,2),
    COALESCE(bc.component_count, 0)::bigint,
    COALESCE(rct.recipe_item_count, 0)::bigint
  FROM scoped_products sp
  LEFT JOIN public.categories c ON c.id = sp.category_id
  LEFT JOIN product_wavg pw ON pw.product_id = sp.id AND pw.branch_id = sp.branch_id
  LEFT JOIN bom_costs bc ON bc.product_id = sp.id
  LEFT JOIN recipe_costs rc ON rc.product_id = sp.id
  LEFT JOIN recipe_counts rct ON rct.product_id = sp.id
  ORDER BY sp.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_costing_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_costing_overview(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
