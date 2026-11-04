-- Stock-count projection of the existing canonical reader; no separate price source.
-- Other readers retain their existing visibility and missing-price metadata.
CREATE OR REPLACE FUNCTION private.stock_count_raw_price(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz)
RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT p.raw_material_id,p.branch_id,COALESCE(p.unit_cost,0::numeric),
   CASE WHEN p.unit_cost IS NULL THEN 'catalog_zero' ELSE p.price_source END,
   CASE WHEN p.unit_cost IS NULL THEN rm.created_at ELSE p.priced_at END,p.reference_number
 FROM private.latest_approved_raw_prices(p_branch_id,p_raw_material_ids,p_as_of) p
 JOIN public.raw_materials rm ON rm.id=p.raw_material_id AND rm.branch_id=p.branch_id;
$f$;
REVOKE ALL ON FUNCTION private.stock_count_raw_price(uuid,uuid[],timestamptz) FROM PUBLIC,anon,authenticated,service_role;
