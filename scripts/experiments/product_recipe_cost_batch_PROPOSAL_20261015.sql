-- Read-only identical recipe estimate: resolve each raw price once per call.
CREATE OR REPLACE FUNCTION public._product_recipe_cost(p_product_id uuid, p_branch_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw_lines AS MATERIALIZED (
    SELECT * FROM public._costing_product_raw_lines(p_product_id,COALESCE(p_branch_id,(SELECT p.branch_id FROM public.products p WHERE p.id=p_product_id)))
  ), raw_prices AS MATERIALIZED (
    SELECT price.* FROM public.get_raw_material_current_prices(
      p_branch_id,
      (SELECT COALESCE(array_agg(DISTINCT rl.raw_material_id)
        FILTER (WHERE rl.raw_material_id IS NOT NULL), '{}'::uuid[]) FROM raw_lines rl)
    ) price
  )
  SELECT CASE
    WHEN bool_or(rl.raw_material_id IS NULL)
      THEN NULL
    WHEN count(*)=0 THEN (
      SELECT CASE WHEN p.product_type='manufactured' THEN NULL
      ELSE COALESCE(NULLIF(public._product_wavg_cost(p.id,p.branch_id),0),NULLIF(p.cost_price,0)) END
      FROM public.products p WHERE p.id=p_product_id
    )
    ELSE COALESCE(round(SUM(rl.quantity*(1+rl.wastage_percent/100.0)
      * COALESCE(price.unit_cost,0)),2),0)
    END
  FROM raw_lines rl
  LEFT JOIN raw_prices price ON price.raw_material_id = rl.raw_material_id

$function$;
