-- Two-branch read-only detail candidate. No business writes or inventory mutations.
-- BACKUP the current production pg_get_functiondef before installation.
-- Original per-line pricing path stays in the ELSE arm for any other branch.
-- Do not execute without passing branch-swap parity tests + performance gate.
CREATE OR REPLACE FUNCTION public.get_product_costing_detail(p_product_id uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    public._product_recipe_cost(p.id, p.branch_id) AS actual_cost,
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

  -- Explicit branch allowlist; evaluate the branch of the authorized product.
  -- Any other branch retains the original per-line pricing path.
  IF v_scope IN ('19c3fd23-d784-455b-8840-f4f2ac619651'::uuid,
                 '279e6662-e901-40b2-9170-7dda0b471ba7'::uuid) THEN
    WITH raw_lines AS MATERIALIZED (
      SELECT * FROM public._costing_product_raw_lines(p_product_id,v_scope)
    ), raw_prices AS MATERIALIZED (
      SELECT price.* FROM public.get_raw_material_current_prices(
        v_scope,
        (SELECT COALESCE(array_agg(DISTINCT rl.raw_material_id), '{}'::uuid[]) FROM raw_lines rl)
      ) price
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'raw_material_id', rm.id,
      'raw_material_name', COALESCE(NULLIF(btrim(rm.name), ''), 'Raw Material'),
      'quantity', rl.quantity,
      'wastage_percent', rl.wastage_percent,
      'unit_cost', COALESCE(price.unit_cost, 0),
      'line_cost', round(
        rl.quantity * (1 + COALESCE(rl.wastage_percent, 0) / 100.0)
        * COALESCE(price.unit_cost, 0),
        2
      ),
      'cost_source', COALESCE(price.price_source, 'unpriced'),
      'cost_priced_at', price.priced_at,
      'cost_reference', price.reference_number,
      'cost_detail', 'Latest known price; current costing estimate',
      'component_group_id', rl.component_group_id,
      'component_group_name', rl.component_group_name,
      'component_group_quantity', rl.component_group_quantity
    ) ORDER BY rl.component_group_name NULLS FIRST, rm.name), '[]'::jsonb)
    INTO v_recipe
    FROM raw_lines rl
    JOIN public.raw_materials rm ON rm.id = rl.raw_material_id
    LEFT JOIN raw_prices price ON price.raw_material_id = rl.raw_material_id;
  ELSE
    WITH raw_lines AS (
      SELECT * FROM public._costing_product_raw_lines(p_product_id,(SELECT p.branch_id FROM public.products p WHERE p.id=p_product_id))
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
  END IF;

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
