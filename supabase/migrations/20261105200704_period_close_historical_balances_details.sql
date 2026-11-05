BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_period_close_raw_report(uuid,date,date)'::regprocedure)) <> 'e240447e39cbda6bf9a6a5e98ed6cf35' THEN
  RAISE EXCEPTION 'PERIOD_CLOSE_REPORT_BASELINE_CHANGED';
 END IF;
END $guard$;
-- Read-only reporting. Use effective movement timestamps, the same historical
-- quantity source used by stock-count historical reconstruction, and one canonical
-- batch price lookup. Never apply a pending count or use FIFO monetary balances.
CREATE OR REPLACE FUNCTION public.get_period_close_raw_report(p_branch_id uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 s timestamptz := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
 e timestamptz := (p_to+1)::timestamp AT TIME ZONE 'Africa/Cairo';
 result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.can_permission('reports.view') AND public.can_permission('reports.costing') AND public.can_permission('reports.financial'),false) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial';
 END IF;
 IF p_branch_id IS NULL OR NOT COALESCE(public.user_may_access_branch(p_branch_id),false) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>92 OR
    public.history_clamp_from(p_from) IS DISTINCT FROM p_from OR public.history_clamp_to(p_to) IS DISTINCT FROM p_to THEN
  RAISE EXCEPTION 'INVALID_REPORT_PERIOD';
 END IF;
 WITH balances AS MATERIALIZED (
  SELECT il.raw_material_id,
   coalesce(sum(il.quantity) FILTER(WHERE il.created_at<s),0) opening,
   sum(il.quantity) closing,
   coalesce(sum(il.quantity) FILTER(WHERE il.created_at>=s AND
    (il.reference_type='purchase_return' OR il.entry_type IN ('purchase','purchase_return'))),0) purchase,
   coalesce(sum(il.quantity) FILTER(WHERE il.created_at>=s AND
    NOT (coalesce(il.reference_type,'')='purchase_return' OR il.entry_type IN ('purchase','purchase_return')) AND
    (il.reference_type='warehouse_transfer' OR il.entry_type IN ('transfer_in','transfer_out','warehouse_transfer'))),0) transfer,
   coalesce(sum(il.quantity) FILTER(WHERE il.created_at>=s AND il.reference_type='stock_count'),0) adjustment
  FROM public.inventory_ledger il
  WHERE il.branch_id=p_branch_id AND il.raw_material_id IS NOT NULL AND il.created_at<e
  GROUP BY il.raw_material_id
 ), prices AS MATERIALIZED (
  SELECT raw_material_id,unit_cost,price_source
  FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT raw_material_id FROM balances))
 ), materials AS MATERIALIZED (
  SELECT r.id,r.name,r.code,coalesce(p.unit_cost,0) price,coalesce(p.price_source,'catalog_zero') source,
   b.opening,b.closing,b.purchase,b.transfer,b.adjustment,
   b.closing-b.opening-b.purchase-b.transfer-b.adjustment other
  FROM balances b JOIN public.raw_materials r ON r.id=b.raw_material_id AND r.branch_id=p_branch_id
  LEFT JOIN prices p ON p.raw_material_id=b.raw_material_id
 )
 SELECT jsonb_build_object('valued_at',statement_timestamp(),'balance_basis','effective_inventory_ledger',
  'materials',coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.name,m.id),'[]'::jsonb),
  'opening_complete',true,'closing_complete',true,
  'opening',coalesce(sum(m.opening*m.price),0),'closing',coalesce(sum(m.closing*m.price),0),
  'purchase',coalesce(sum(m.purchase*m.price),0),'transfer',coalesce(sum(m.transfer*m.price),0),
  'unpriced',0)
 INTO result FROM materials m;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_period_close_raw_report(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_period_close_raw_report(uuid,date,date) TO authenticated;

-- On-demand, bounded movement evidence. One page plus its full filtered total;
-- classification and valuation are identical to the summary above. The full
-- physical movement contributes to stock even if its original invoice has been
-- removed or is not visible. Document references are checked only for this page;
-- no hidden invoice amounts or IDs are returned. This preserves physical truth
-- without thousands of nested financial-document permission checks.
CREATE OR REPLACE FUNCTION public.get_period_close_raw_movements(
 p_branch_id uuid,p_from date,p_to date,p_kind text DEFAULT 'all',
 p_material_id uuid DEFAULT NULL,p_page integer DEFAULT 0,p_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 s timestamptz := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
 e timestamptz := (p_to+1)::timestamp AT TIME ZONE 'Africa/Cairo';
 result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT COALESCE(public.can_permission('reports.view') AND public.can_permission('reports.costing') AND public.can_permission('reports.financial'),false) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial';
 END IF;
 IF p_branch_id IS NULL OR NOT COALESCE(public.user_may_access_branch(p_branch_id),false) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>92 OR
    public.history_clamp_from(p_from) IS DISTINCT FROM p_from OR public.history_clamp_to(p_to) IS DISTINCT FROM p_to THEN
  RAISE EXCEPTION 'INVALID_REPORT_PERIOD';
 END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('all','purchase','transfer') OR p_page IS NULL OR p_page<0 OR p_page>100000 OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>200 THEN
  RAISE EXCEPTION 'INVALID_REPORT_OPTIONS';
 END IF;
 WITH movements AS MATERIALIZED (
  SELECT il.id,il.raw_material_id,r.name,r.code,il.created_at,il.entry_type,
   il.reference_type,il.reference_id,il.reference_number,il.quantity,w.name warehouse_name
  FROM public.inventory_ledger il
  JOIN public.raw_materials r ON r.id=il.raw_material_id AND r.branch_id=p_branch_id
  LEFT JOIN public.warehouses w ON w.id=il.warehouse_id
  WHERE il.branch_id=p_branch_id AND il.created_at>=s AND il.created_at<e
   AND (p_material_id IS NULL OR il.raw_material_id=p_material_id)
   AND (p_kind='all' OR CASE
    WHEN il.reference_type='purchase_return' OR il.entry_type IN ('purchase','purchase_return') THEN 'purchase'
    WHEN il.reference_type='warehouse_transfer' OR il.entry_type IN ('transfer_in','transfer_out','warehouse_transfer') THEN 'transfer'
    ELSE 'other' END=p_kind)

 ), prices AS MATERIALIZED (
  SELECT raw_material_id,unit_cost FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT DISTINCT raw_material_id FROM movements))
 ), valued AS MATERIALIZED (
  SELECT m.*,coalesce(p.unit_cost,0) price,m.quantity*coalesce(p.unit_cost,0) value
  FROM movements m LEFT JOIN prices p USING(raw_material_id)
 )
 SELECT jsonb_build_object(
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY page.created_at,page.id) FROM
   (SELECT v.id,v.raw_material_id,v.name,v.code,v.created_at,v.entry_type,v.reference_type,
     CASE WHEN private.financial_reference_visible(v.reference_type,v.reference_id,(md5(v.id::text))::uuid,p_branch_id,v.created_at)
      THEN v.reference_number ELSE NULL END reference_number,
     v.quantity,v.warehouse_name,v.price,v.value
    FROM (SELECT * FROM valued ORDER BY created_at,id LIMIT p_page_size OFFSET p_page*p_page_size) v) page),'[]'::jsonb),
  'count',(SELECT count(*) FROM valued),'total',coalesce((SELECT sum(value) FROM valued),0)) INTO result;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_period_close_raw_movements(uuid,date,date,text,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_period_close_raw_movements(uuid,date,date,text,uuid,integer,integer) TO authenticated;

COMMIT;
