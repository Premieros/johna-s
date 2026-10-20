-- UNAPPLIED: report reads only. No write-time work, helper ACL changes or FIFO reads.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION public.get_sold_recipe_consumption_report(
 p_branch_id uuid,p_from_date date,p_to_date date,p_group_by text DEFAULT 'material',
 p_search text DEFAULT '',p_page integer DEFAULT 0,p_page_size integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE v_from date:=public.history_clamp_from(p_from_date);v_to date:=public.history_clamp_to(p_to_date);v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;
 IF NOT (public.can_permission('reports.view') AND public.can_permission('reports.costing')) THEN RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing';END IF;
 IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED';END IF;
 IF v_from IS NULL OR v_to IS NULL OR v_to<v_from OR v_to-v_from>366 THEN RAISE EXCEPTION 'INVALID_RANGE';END IF;
 IF p_group_by IS NULL OR p_group_by NOT IN ('material','product') OR p_page IS NULL OR p_page<0 OR p_page>1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'INVALID_REPORT_OPTIONS';END IF;
 WITH RECURSIVE sales_scope AS MATERIALIZED (
  SELECT s.id,s.branch_id FROM public.sales s
  WHERE s.branch_id=ANY(ARRAY(SELECT b.id FROM public.branches b WHERE (p_branch_id IS NULL OR b.id=p_branch_id) AND public.user_may_access_branch(b.id)))
   AND s.created_at >= (v_from::timestamp AT TIME ZONE 'Africa/Cairo')
   AND s.created_at < ((v_to+1)::timestamp AT TIME ZONE 'Africa/Cairo')
   AND s.status IN ('completed','returned','refunded')
 ), sold_units AS MATERIALIZED (
  -- Reduce invoice lines to unique product/unit pairs before any recipe expansion.
  SELECT s.branch_id,i.product_id,COALESCE(i.product_id,i.id) product_key,COALESCE(NULLIF(i.unit_name,''),'piece') unit_name,
   SUM(GREATEST(COALESCE(i.quantity,0),0)) gross_quantity,
   SUM(LEAST(GREATEST(COALESCE(i.refunded_quantity,0),0),GREATEST(COALESCE(i.quantity,0),0))) returned_quantity
  FROM sales_scope s JOIN public.sale_items i ON i.sale_id=s.id
  GROUP BY s.branch_id,i.product_id,COALESCE(i.product_id,i.id),COALESCE(NULLIF(i.unit_name,''),'piece')
  HAVING SUM(GREATEST(COALESCE(i.quantity,0)-COALESCE(i.refunded_quantity,0),0))>0
  LIMIT 5001
 ), unit_options AS MATERIALIZED (
  SELECT pu.product_id,pu.unit_name,COUNT(*) n,MIN(pu.conversion_factor) factor
  FROM public.product_units pu JOIN (SELECT DISTINCT product_id FROM sold_units) p ON p.product_id=pu.product_id
  GROUP BY pu.product_id,pu.unit_name
 ), unit_counts AS (
  SELECT product_id,SUM(n) n FROM unit_options GROUP BY product_id
 ), normalized_units AS MATERIALIZED (
  SELECT u.*,CASE WHEN o.n=1 AND o.factor>0 THEN o.factor
   WHEN c.n IS NULL THEN 1::numeric
   WHEN u.unit_name='piece' AND EXISTS(SELECT 1 FROM public.product_units b WHERE b.product_id=u.product_id AND b.is_base AND b.conversion_factor=1) THEN 1::numeric
   END factor
  FROM sold_units u LEFT JOIN unit_options o ON o.product_id=u.product_id AND o.unit_name=u.unit_name
  LEFT JOIN unit_counts c ON c.product_id=u.product_id
 ), sold AS MATERIALIZED (
  SELECT u.branch_id,u.product_id,u.product_key,p.name product_name,
   SUM(u.gross_quantity*COALESCE(u.factor,0)) gross_quantity,
   SUM(u.returned_quantity*COALESCE(u.factor,0)) returned_quantity,
   COUNT(*) FILTER(WHERE u.factor IS NULL) invalid_units,p.id IS NULL product_missing
  FROM normalized_units u LEFT JOIN public.products p ON p.id=u.product_id AND p.branch_id=u.branch_id
  GROUP BY u.branch_id,u.product_id,u.product_key,p.name,p.id
 ), latest_recipe AS MATERIALIZED (
  SELECT DISTINCT ON(r.product_id,r.branch_id) r.id,r.product_id,r.branch_id,r.yield_quantity
  FROM public.recipes r JOIN sold s ON s.product_id=r.product_id AND s.branch_id=r.branch_id
  WHERE COALESCE(r.is_active,true)
  ORDER BY r.product_id,r.branch_id,COALESCE(r.version,1) DESC,r.created_at DESC,r.id DESC
 ), raw_walk(product_id,branch_id,unit_id,multiplier,path,cycle,valid,depth) AS (
  SELECT s.product_id,s.branch_id,l.unit_id,l.quantity::numeric,ARRAY[l.unit_id]::uuid[],false,
   COALESCE(g.branch_id=s.branch_id AND g.is_active AND g.unit_type='manufactured',false),1
  FROM sold s JOIN public.product_unit_links l ON l.product_id=s.product_id
  LEFT JOIN public.inventory_units g ON g.id=l.unit_id WHERE l.quantity>0
  UNION ALL
  SELECT w.product_id,w.branch_id,l.component_unit_id,
   w.multiplier*l.quantity*(1+COALESCE(l.wastage_percent,0)/100.0),w.path||l.component_unit_id,l.component_unit_id=ANY(w.path),
   COALESCE(g.branch_id=w.branch_id AND g.is_active AND g.unit_type='manufactured',false),w.depth+1
  FROM raw_walk w JOIN public.inventory_unit_recipe_units l ON l.unit_id=w.unit_id
  LEFT JOIN public.inventory_units g ON g.id=l.component_unit_id
  WHERE NOT w.cycle AND w.valid AND w.depth<32 AND l.quantity>0
 ), walk AS MATERIALIZED (
  SELECT * FROM raw_walk LIMIT 20001
 ), raw_lines AS MATERIALIZED (
  -- Same canonical composition/yield/waste rules as _costing_product_raw_lines;
  -- set-based across SOLD products, without broadening that private helper's ACL.
  SELECT r.product_id,r.branch_id,CASE WHEN rm.branch_id=r.branch_id THEN i.raw_material_id END raw_material_id,
   i.quantity/NULLIF(r.yield_quantity,0)*(1+COALESCE(i.wastage_percent,0)/100.0) quantity
  FROM latest_recipe r JOIN public.recipe_items i ON i.recipe_id=r.id
  LEFT JOIN public.raw_materials rm ON rm.id=i.raw_material_id
  UNION ALL
  SELECT w.product_id,w.branch_id,CASE WHEN rm.branch_id=w.branch_id THEN i.raw_material_id END,
   w.multiplier*i.quantity*(1+COALESCE(i.wastage_percent,0)/100.0)
  FROM walk w JOIN public.inventory_unit_recipes i ON i.unit_id=w.unit_id
  LEFT JOIN public.raw_materials rm ON rm.id=i.raw_material_id WHERE NOT w.cycle AND w.valid
  UNION ALL
  SELECT w.product_id,w.branch_id,NULL::uuid,NULL::numeric FROM walk w
  WHERE w.cycle OR NOT w.valid OR (w.depth=32 AND EXISTS(SELECT 1 FROM public.inventory_unit_recipe_units l WHERE l.unit_id=w.unit_id AND l.quantity>0))
   OR (NOT EXISTS(SELECT 1 FROM public.inventory_unit_recipes i WHERE i.unit_id=w.unit_id AND i.quantity>0)
    AND NOT EXISTS(SELECT 1 FROM public.inventory_unit_recipe_units l WHERE l.unit_id=w.unit_id AND l.quantity>0))
 ), recipe_lines AS MATERIALIZED (
  SELECT product_id,branch_id,raw_material_id,SUM(quantity) quantity,
   bool_or(raw_material_id IS NULL OR quantity IS NULL OR quantity<=0) invalid
  FROM raw_lines GROUP BY product_id,branch_id,raw_material_id
 ), product_status AS MATERIALIZED (
  SELECT s.*,NOT EXISTS(SELECT 1 FROM recipe_lines r WHERE r.product_id=s.product_id AND r.branch_id=s.branch_id)
   OR EXISTS(SELECT 1 FROM recipe_lines r WHERE r.product_id=s.product_id AND r.branch_id=s.branch_id AND r.invalid) recipe_missing
  FROM sold s
 ), quantities AS MATERIALIZED (
  SELECT s.branch_id,CASE WHEN p_group_by='product' THEN s.product_key END product_key,
   CASE WHEN p_group_by='product' THEN s.product_id END product_id,
   CASE WHEN p_group_by='product' THEN s.product_name END product_name,
   r.raw_material_id,SUM(s.gross_quantity*r.quantity) consumed_quantity,SUM(s.returned_quantity*r.quantity) returned_quantity,
   CASE WHEN p_group_by='product' THEN MAX(s.gross_quantity-s.returned_quantity) END product_sold_quantity
  FROM product_status s JOIN recipe_lines r ON r.product_id=s.product_id AND r.branch_id=s.branch_id
  WHERE NOT r.invalid AND r.raw_material_id IS NOT NULL
  GROUP BY s.branch_id,CASE WHEN p_group_by='product' THEN s.product_key END,
   CASE WHEN p_group_by='product' THEN s.product_id END,CASE WHEN p_group_by='product' THEN s.product_name END,r.raw_material_id
 ), raw_prices AS MATERIALIZED (
  SELECT p.* FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT DISTINCT raw_material_id FROM quantities)) p
 ), priced_rows AS MATERIALIZED (
  SELECT q.branch_id,b.name branch_name,q.product_id,q.product_name,q.raw_material_id,rm.name raw_material_name,rm.code raw_material_code,
   COALESCE(u.symbol,u.code,u.name,'') unit_name,q.consumed_quantity,q.returned_quantity,0::numeric waste_quantity,
   q.consumed_quantity-q.returned_quantity net_quantity,q.product_sold_quantity,
   COALESCE(p.unit_cost,0) unit_price,COALESCE(p.price_source,'unpriced') price_source,p.priced_at price_date,p.reference_number price_reference,
   (q.consumed_quantity-q.returned_quantity)*COALESCE(p.unit_cost,0) consumption_value,p.unit_cost IS NULL price_missing
  FROM quantities q JOIN public.raw_materials rm ON rm.id=q.raw_material_id AND rm.branch_id=q.branch_id
  JOIN public.branches b ON b.id=q.branch_id LEFT JOIN public.measurement_units u ON u.id=rm.unit_id
  LEFT JOIN raw_prices p ON p.branch_id=q.branch_id AND p.raw_material_id=q.raw_material_id
 ), rows AS MATERIALIZED (
  SELECT * FROM priced_rows WHERE COALESCE(p_search,'')='' OR concat_ws(' ',raw_material_name,raw_material_code,product_name,branch_name) ILIKE '%'||p_search||'%'
 ), page AS (
  SELECT * FROM rows ORDER BY branch_name,COALESCE(product_name,''),raw_material_name,branch_id,product_id NULLS FIRST,raw_material_id
  LIMIT p_page_size OFFSET (p_page::bigint*p_page_size)
 ) SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM page p),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('count',COUNT(*),'total',round(COALESCE(SUM(consumption_value),0),2),
   'unpriced_count',COUNT(*) FILTER(WHERE price_missing),'unattributed_count',0,
   'missing_recipe_count',(SELECT COUNT(*) FROM product_status WHERE recipe_missing OR product_missing),
   'invalid_unit_count',(SELECT COALESCE(SUM(invalid_units),0) FROM product_status),
   'complete',COUNT(*) FILTER(WHERE price_missing)=0 AND NOT EXISTS(SELECT 1 FROM product_status WHERE recipe_missing OR product_missing OR invalid_units>0)) FROM rows),
  'recipe_issues',COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',branch_id,'product_id',product_id,'product_name',product_name,'missing_recipe',recipe_missing OR product_missing,'invalid_units',invalid_units)) FROM product_status WHERE recipe_missing OR product_missing OR invalid_units>0),'[]'::jsonb),
  'scope_limit_exceeded',(SELECT COUNT(*)>=5001 FROM sold_units) OR (SELECT COUNT(*)>=20001 FROM walk),
  'pricing_basis','current_recipe_latest_approved','from',v_from,'to',v_to,'generated_at',statement_timestamp()) INTO v_result;
 IF (v_result->>'scope_limit_exceeded')::boolean THEN RAISE EXCEPTION 'REPORT_SOURCE_LIMIT';END IF;
 RETURN v_result-'scope_limit_exceeded';
END $function$;
REVOKE ALL ON FUNCTION public.get_sold_recipe_consumption_report(uuid,date,date,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sold_recipe_consumption_report(uuid,date,date,text,text,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
