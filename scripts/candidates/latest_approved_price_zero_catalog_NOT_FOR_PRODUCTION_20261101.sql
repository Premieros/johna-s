-- CANDIDATE ONLY; DO NOT DEPLOY before disposable-DB regression and accounting review.
-- Extends the existing price reader; no new engine and no source-record fabrication.
-- A verified 0 catalog price is valid if catalog row was last updated no later
-- than the count. NULL remains unpriced; positive approved sources win.
-- The observed 208 missing November count prices all have a current zero catalog
-- default with updated_at <= their count.created_at (read-only audit).
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF position('COALESCE(w.price_source,''unpriced'')' IN
    pg_get_functiondef('private.latest_approved_raw_prices(uuid,uuid[],timestamptz)'::regprocedure))=0
 THEN RAISE EXCEPTION 'LATEST_APPROVED_PRICE_FUNCTION_SOURCE_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.latest_approved_raw_prices(p_branch_id uuid,p_raw_material_ids uuid[],p_as_of timestamptz)
RETURNS TABLE(raw_material_id uuid,branch_id uuid,unit_cost numeric,price_source text,priced_at timestamptz,reference_number text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $f$
 SELECT rm.id,rm.branch_id,
  CASE WHEN w.unit_cost IS NULL AND rm.default_cost=0 AND rm.updated_at IS NOT NULL
      AND (p_as_of IS NULL OR rm.updated_at<=p_as_of) THEN 0::numeric ELSE w.unit_cost END,
  CASE WHEN w.unit_cost IS NULL AND rm.default_cost=0 AND rm.updated_at IS NOT NULL
      AND (p_as_of IS NULL OR rm.updated_at<=p_as_of) THEN 'catalog_zero' ELSE COALESCE(w.price_source,'unpriced') END,
  CASE WHEN w.unit_cost IS NULL AND rm.default_cost=0 AND rm.updated_at IS NOT NULL
      AND (p_as_of IS NULL OR rm.updated_at<=p_as_of) THEN rm.updated_at ELSE w.priced_at END,
  w.reference_number
 FROM public.raw_materials rm
 LEFT JOIN LATERAL (
  SELECT CASE WHEN c.source_kind='purchase_items' THEN (norm.value->>'stock_unit_cost')::numeric(18,6) ELSE c.unit_cost::numeric(18,6) END AS unit_cost,
   CASE WHEN c.source_kind IN('inventory_ledger','purchase_items') THEN 'purchase' WHEN c.source_kind='stock_count_items' THEN 'stock_count' ELSE 'pricing' END AS price_source,
   c.priced_at,c.reference_number
  FROM private.raw_approved_price_read_model c
  LEFT JOIN LATERAL(SELECT public._normalize_raw_purchase_uom(c.raw_material_id,c.purchase_quantity,c.unit_cost,c.purchase_unit) AS value WHERE c.source_kind='purchase_items') norm ON true
  WHERE c.branch_id=rm.branch_id AND c.raw_material_id=rm.id AND (p_as_of IS NULL OR c.priced_at<=p_as_of)
   AND private.raw_approved_price_visible(c.source_kind,c.source_id,c.parent_id,c.raw_material_id,c.branch_id)
   AND (c.source_kind<>'purchase_items' OR (COALESCE((norm.value->>'success')::boolean,false) AND COALESCE((norm.value->>'stock_unit_cost')::numeric,0)>0))
  ORDER BY c.priced_at DESC NULLS LAST,c.source_rank,c.reference_number DESC NULLS LAST,c.event_id DESC LIMIT 1
 ) w ON true
 WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id) AND(p_raw_material_ids IS NULL OR rm.id=ANY(p_raw_material_ids));
$f$;
COMMIT;
