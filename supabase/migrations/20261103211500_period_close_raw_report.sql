CREATE OR REPLACE FUNCTION public.get_period_close_raw_report(p_branch_id uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 s timestamptz := p_from::timestamp AT TIME ZONE 'Africa/Cairo';
 e timestamptz := (p_to+1)::timestamp AT TIME ZONE 'Africa/Cairo';
 result jsonb;
BEGIN
 IF NOT COALESCE(public.can_permission('reports.view') AND public.can_permission('reports.costing') AND public.can_permission('reports.financial'),false) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED:reports.financial';
 END IF;
 IF p_branch_id IS NULL OR NOT COALESCE(public.user_may_access_branch(p_branch_id),false) THEN RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>92 OR
    public.history_clamp_from(p_from) IS DISTINCT FROM p_from OR public.history_clamp_to(p_to) IS DISTINCT FROM p_to THEN
  RAISE EXCEPTION 'INVALID_REPORT_PERIOD';
 END IF;
 WITH counts AS MATERIALIZED (
  SELECT DISTINCT ON (sc.warehouse_id, boundary.kind) sc.id,sc.warehouse_id,boundary.kind
  FROM (VALUES ('opening',s,(p_from+1)::timestamp AT TIME ZONE 'Africa/Cairo'),('closing',p_to::timestamp AT TIME ZONE 'Africa/Cairo',e)) boundary(kind,lo,hi)
  JOIN public.stock_counts sc ON sc.branch_id=p_branch_id AND sc.created_at>=boundary.lo AND sc.created_at<boundary.hi
  WHERE sc.status='applied' AND sc.count_type='full'
   AND EXISTS (SELECT 1 FROM public.stock_count_items i WHERE i.stock_count_id=sc.id AND i.raw_material_id IS NOT NULL)
  ORDER BY sc.warehouse_id,boundary.kind,sc.created_at DESC,sc.id DESC
 ), moves AS MATERIALIZED (
  SELECT raw_material_id,warehouse_id,quantity,
    CASE WHEN reference_type='purchase_return' OR entry_type IN ('purchase','purchase_return') THEN 'purchase'
         ELSE 'transfer' END kind
  FROM public.inventory_ledger
  WHERE branch_id=p_branch_id AND created_at>=s AND created_at<e AND raw_material_id IS NOT NULL
    AND (reference_type IN ('purchase_return','warehouse_transfer') OR entry_type IN ('purchase','purchase_return','transfer_in','transfer_out','warehouse_transfer'))
 ), counted AS (
  SELECT i.raw_material_id,c.warehouse_id,i.counted_quantity quantity,c.kind
  FROM counts c JOIN public.stock_count_items i ON i.stock_count_id=c.id
  WHERE i.raw_material_id IS NOT NULL
 ), inputs AS MATERIALIZED (
  SELECT * FROM counted UNION ALL SELECT * FROM moves
 ), totals AS (
  SELECT raw_material_id,kind,sum(quantity) quantity FROM inputs GROUP BY raw_material_id,kind
 ), prices AS MATERIALIZED (
  SELECT raw_material_id,unit_cost FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT DISTINCT raw_material_id FROM totals))
 ), coverage AS (
  SELECT count(DISTINCT warehouse_id) warehouse_count,
   count(DISTINCT warehouse_id) FILTER (WHERE kind='opening') opening_count,
   count(DISTINCT warehouse_id) FILTER (WHERE kind='closing') closing_count,
   bool_or(warehouse_id IS NULL) unassigned
  FROM inputs
 )
 SELECT jsonb_build_object(
   'valued_at',statement_timestamp(),
   'opening_complete',c.warehouse_count>0 AND c.opening_count=c.warehouse_count AND NOT coalesce(c.unassigned,false),
   'closing_complete',c.warehouse_count>0 AND c.closing_count=c.warehouse_count AND NOT coalesce(c.unassigned,false),
   'opening',coalesce(sum(t.quantity*coalesce(p.unit_cost,0)) FILTER (WHERE t.kind='opening'),0),
   'closing',coalesce(sum(t.quantity*coalesce(p.unit_cost,0)) FILTER (WHERE t.kind='closing'),0),
   'purchase',coalesce(sum(t.quantity*coalesce(p.unit_cost,0)) FILTER (WHERE t.kind='purchase'),0),
   'transfer',coalesce(sum(t.quantity*coalesce(p.unit_cost,0)) FILTER (WHERE t.kind='transfer'),0),
   'unpriced',count(DISTINCT t.raw_material_id) FILTER (WHERE p.unit_cost IS NULL AND t.quantity<>0))
 INTO result FROM coverage c LEFT JOIN totals t ON true LEFT JOIN prices p USING(raw_material_id)
 GROUP BY c.warehouse_count,c.opening_count,c.closing_count,c.unassigned;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_period_close_raw_report(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_period_close_raw_report(uuid,date,date) TO authenticated;
