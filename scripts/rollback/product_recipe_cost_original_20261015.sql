CREATE OR REPLACE FUNCTION public._product_recipe_cost(p_product_id uuid, p_branch_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw_lines AS (
    SELECT * FROM public._costing_product_raw_lines(p_product_id,COALESCE(p_branch_id,(SELECT p.branch_id FROM public.products p WHERE p.id=p_product_id)))
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
      * COALESCE(public._raw_cost_for_costing(rl.raw_material_id,p_branch_id),0)),2),0)
    END
  FROM raw_lines rl

$function$;
