-- Read-only consolidation. No stock/journal/debt mutation or core writer routing.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_raw_material_current_prices(uuid,uuid[])'::regprocedure))<>'4815560db7b91b4559283a7d3f160957'
 OR md5(pg_get_functiondef('private.latest_approved_raw_prices(uuid,uuid[],timestamptz)'::regprocedure))<>'4907c536c382a105a3ca5ed12a1e61c4'
 THEN RAISE EXCEPTION 'UNIFIED_RAW_READ_BASELINE_CHANGED'; END IF;
END $guard$;

-- The indexed canonical resolver and its authorization remain unchanged.
-- Zero is a valid default; missing access and query failures remain errors/absent
-- rows. Do not fall back to FIFO, catalog default_cost, or a second price source.
CREATE OR REPLACE FUNCTION public.get_raw_material_current_prices(
 p_branch_id uuid DEFAULT NULL,p_raw_material_ids uuid[] DEFAULT NULL
) RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,
 price_source text,priced_at timestamptz,reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
 SELECT p.raw_material_id,p.branch_id,COALESCE(p.unit_cost,0::numeric),
  CASE WHEN p.unit_cost IS NULL THEN 'catalog_zero' ELSE p.price_source END,
  p.priced_at,p.reference_number
 FROM private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,NULL::timestamptz) p;
$function$;

-- Page material identities BEFORE aggregating quantities/resolving prices.
-- At most500 output rows, including inactive materials with a retained balance.
-- INVOKER keeps original material, batch, branch and price-source RLS in force.
CREATE FUNCTION public.get_raw_material_stock_summary(
 p_branch_id uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 500
) RETURNS TABLE(id uuid,raw_material_id uuid,branch_id uuid,quantity numeric,
 avg_cost numeric,min_stock numeric,updated_at timestamptz,raw_material jsonb,
 branch jsonb,price_source text,priced_at timestamptz,reference_number text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id)
 THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>500
 THEN RAISE EXCEPTION 'INVALID_PAGE'; END IF;
 RETURN QUERY
 WITH materials AS MATERIALIZED (
  SELECT rm.* FROM public.raw_materials rm
  WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id)
  ORDER BY rm.id LIMIT p_limit OFFSET p_offset
 ), balances AS MATERIALIZED (
  SELECT q.raw_material_id,q.branch_id,sum(q.quantity) AS qty
  FROM private.raw_stock_quantities q
  JOIN materials m ON m.id=q.raw_material_id AND m.branch_id=q.branch_id
  GROUP BY q.raw_material_id,q.branch_id
 ), prices AS MATERIALIZED (
  SELECT cp.* FROM public.get_raw_material_current_prices(
   p_branch_id,ARRAY(SELECT m.id FROM materials m)) cp
 )
 SELECT m.id,m.id,m.branch_id,COALESCE(b.qty,0),COALESCE(cp.unit_cost,0),
  COALESCE(m.min_stock,0)::numeric,m.updated_at,
  to_jsonb(m)||jsonb_build_object('unit',CASE WHEN u.id IS NULL THEN NULL
   ELSE jsonb_build_object('name',u.name,'code',u.code,'symbol',u.symbol) END),
  CASE WHEN br.id IS NULL THEN NULL ELSE jsonb_build_object('id',br.id,'name',br.name) END,
  COALESCE(cp.price_source,'catalog_zero'),cp.priced_at,cp.reference_number
 FROM materials m LEFT JOIN balances b ON b.raw_material_id=m.id AND b.branch_id=m.branch_id
 LEFT JOIN prices cp ON cp.raw_material_id=m.id AND cp.branch_id=m.branch_id
 LEFT JOIN public.measurement_units u ON u.id=m.unit_id
 LEFT JOIN public.branches br ON br.id=m.branch_id
 ORDER BY m.id;
END $function$;
REVOKE ALL ON FUNCTION public.get_raw_material_stock_summary(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_raw_material_stock_summary(uuid,integer,integer) TO authenticated,service_role;
COMMIT;
