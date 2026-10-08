BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

-- Read-only estimate source. Existing public costing RPCs keep their guards.
CREATE FUNCTION public._costing_product_raw_lines(p_product_id uuid,p_branch_id uuid)
RETURNS TABLE(raw_material_id uuid,quantity numeric,wastage_percent numeric,
  component_group_id uuid,component_group_name text,component_group_quantity numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $function$
  WITH RECURSIVE latest_recipe AS (
    SELECT r.id,r.yield_quantity FROM public.recipes r
    WHERE r.product_id=p_product_id AND r.branch_id=p_branch_id AND COALESCE(r.is_active,true)
    ORDER BY COALESCE(r.version,1) DESC,r.created_at DESC,r.id DESC LIMIT 1
  ), walk(unit_id,multiplier,path,cycle,valid) AS (
    SELECT pul.unit_id,pul.quantity::numeric,ARRAY[pul.unit_id]::uuid[],false,
      iu.branch_id=p_branch_id AND iu.is_active AND iu.unit_type='manufactured'
    FROM public.product_unit_links pul JOIN public.inventory_units iu ON iu.id=pul.unit_id
    WHERE pul.product_id=p_product_id AND pul.quantity>0
    UNION ALL
    SELECT rel.component_unit_id,
      w.multiplier*rel.quantity*(1+COALESCE(rel.wastage_percent,0)/100.0),
      w.path||rel.component_unit_id,rel.component_unit_id=ANY(w.path),
      child.branch_id=p_branch_id AND child.is_active AND child.unit_type='manufactured'
    FROM walk w JOIN public.inventory_unit_recipe_units rel ON rel.unit_id=w.unit_id
    JOIN public.inventory_units child ON child.id=rel.component_unit_id
    WHERE NOT w.cycle AND w.valid AND rel.quantity>0
  ), lines AS (
    SELECT ri.raw_material_id,ri.quantity/NULLIF(lr.yield_quantity,0) quantity,
      COALESCE(ri.wastage_percent,0) wastage_percent,NULL::uuid component_group_id,
      NULL::text component_group_name,NULL::numeric component_group_quantity
    FROM latest_recipe lr JOIN public.recipe_items ri ON ri.recipe_id=lr.id
    UNION ALL
    SELECT iur.raw_material_id,w.multiplier*iur.quantity,COALESCE(iur.wastage_percent,0),
      iu.id,iu.name,w.multiplier
    FROM walk w JOIN public.inventory_units iu ON iu.id=w.unit_id
    JOIN public.inventory_unit_recipes iur ON iur.unit_id=w.unit_id
    WHERE NOT w.cycle AND w.valid
    UNION ALL
    -- An invalid/empty/cyclic group must never become a complete zero-cost group.
    SELECT NULL::uuid,1::numeric,0::numeric,w.unit_id,iu.name,w.multiplier
    FROM walk w JOIN public.inventory_units iu ON iu.id=w.unit_id
    WHERE w.cycle OR NOT w.valid OR (
      NOT EXISTS(SELECT 1 FROM public.inventory_unit_recipes i WHERE i.unit_id=w.unit_id AND i.quantity>0)
      AND NOT EXISTS(SELECT 1 FROM public.inventory_unit_recipe_units l WHERE l.unit_id=w.unit_id AND l.quantity>0)
    )
  ) SELECT CASE WHEN rm.branch_id=p_branch_id THEN l.raw_material_id ELSE NULL::uuid END,
    l.quantity,l.wastage_percent,l.component_group_id,l.component_group_name,l.component_group_quantity
    FROM lines l LEFT JOIN public.raw_materials rm ON rm.id=l.raw_material_id
$function$;
REVOKE ALL ON FUNCTION public._costing_product_raw_lines(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._costing_product_raw_lines(uuid,uuid) TO postgres,service_role;

DO $patch$
DECLARE definition text; start_at integer; end_at integer; original text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public._product_recipe_cost(uuid,uuid)'::regprocedure) INTO definition;
  start_at:=position('  WITH raw_lines AS (' IN definition);
  end_at:=position('  SELECT CASE' IN definition);
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'RECIPE_COST_BASELINE_MISMATCH'; END IF;
  original:=substring(definition FROM start_at FOR end_at-start_at);
  replacement:=E'  WITH raw_lines AS (\n    SELECT * FROM public._costing_product_raw_lines(p_product_id,COALESCE(p_branch_id,(SELECT p.branch_id FROM public.products p WHERE p.id=p_product_id)))\n  )\n';
  definition:=replace(definition,original,replacement);
  original:='    ELSE COALESCE(round(SUM(';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'RECIPE_FALLBACK_BASELINE_MISMATCH'; END IF;
  replacement:=$fallback$    WHEN count(*)=0 THEN (
      SELECT CASE WHEN p.product_type='manufactured' THEN NULL
      ELSE COALESCE(NULLIF(public._product_wavg_cost(p.id,p.branch_id),0),NULLIF(p.cost_price,0)) END
      FROM public.products p WHERE p.id=p_product_id
    )
    ELSE COALESCE(round(SUM($fallback$;
  EXECUTE replace(definition,original,replacement);

  SELECT pg_get_functiondef('public._product_bom_cost(uuid,uuid)'::regprocedure) INTO definition;
  original:='COALESCE(public._product_recipe_cost(p_product_id, p_branch_id), 0)';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'COST_SOURCE_BASELINE_MISMATCH'; END IF;
  EXECUTE replace(definition,original,'public._product_recipe_cost(p_product_id, p_branch_id)');

  SELECT pg_get_functiondef('public.get_costing_overview(uuid)'::regprocedure) INTO definition;
  start_at:=position('  recipe_lines AS MATERIALIZED (' IN definition);
  end_at:=position('  recipe_costs AS MATERIALIZED (' IN definition);
  IF start_at=0 OR end_at<=start_at OR position('IF NOT public.is_pos_admin() THEN' IN definition)=0
    THEN RAISE EXCEPTION 'COSTING_OVERVIEW_BASELINE_MISMATCH'; END IF;
  original:=substring(definition FROM start_at FOR end_at-start_at);
  replacement:=E'  recipe_lines AS MATERIALIZED (\n    SELECT sp.id AS product_id,rl.* FROM scoped_products sp\n    CROSS JOIN LATERAL public._costing_product_raw_lines(sp.id,sp.branch_id) rl\n  ),\n';
  definition:=replace(definition,original,replacement);
  original:='p.product_type, p.sale_price';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'PRODUCT_SCOPE_BASELINE_MISMATCH'; END IF;
  definition:=replace(definition,original,'p.product_type, p.sale_price, p.cost_price');
  replacement:=$current$CASE WHEN COALESCE(rct.recipe_item_count,0)>0 THEN rc.cost
    WHEN sp.product_type='manufactured' THEN NULL
    ELSE COALESCE(NULLIF(pw.unit_cost,0),NULLIF(sp.cost_price,0)) END::numeric(12,2)$current$;
  original:='COALESCE(rc.cost, 0)::numeric(12,2)';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'THEORETICAL_COST_BASELINE_MISMATCH'; END IF;
  definition:=replace(definition,original,replacement);
  original:='CASE WHEN COALESCE(rct.recipe_item_count,0)>0 THEN rc.cost ELSE 0 END::numeric(12,2)';
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'CURRENT_COST_BASELINE_MISMATCH'; END IF;
  EXECUTE replace(definition,original,replacement);

  SELECT pg_get_functiondef('public.get_product_costing_detail(uuid,uuid)'::regprocedure) INTO definition;
  start_at:=position('  WITH raw_lines AS (' IN definition);
  end_at:=position('  SELECT COALESCE(jsonb_agg(jsonb_build_object(' IN substring(definition FROM start_at));
  IF start_at=0 OR end_at=0 OR position('public.can_permission(''reports.costing'')' IN definition)=0
    THEN RAISE EXCEPTION 'COSTING_DETAIL_BASELINE_MISMATCH'; END IF;
  original:=substring(definition FROM start_at FOR end_at-1);
  replacement:=E'  WITH raw_lines AS (\n    SELECT * FROM public._costing_product_raw_lines(p_product_id,(SELECT p.branch_id FROM public.products p WHERE p.id=p_product_id))\n  )\n';
  EXECUTE replace(definition,original,replacement);
END;
$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
