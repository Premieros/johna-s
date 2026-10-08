-- Supplement zero historical consumption with known prices in reporting only.
-- No receipt, stock, ledger, journal, invoice or kitchen operation is rewritten.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

CREATE FUNCTION public.get_historical_sale_cost_estimates(
  p_branch_id uuid DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL
)
RETURNS TABLE(sale_id uuid,estimated_cost numeric,priced_movements bigint,unpriced_movements bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_permission('reports.costing') THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id)
    THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to<p_from
    THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;

  RETURN QUERY
  WITH scoped_sales AS MATERIALIZED (
    SELECT s.id,s.branch_id,s.refunded_amount
    FROM public.sales s
    WHERE (p_branch_id IS NULL OR s.branch_id=p_branch_id)
      AND public.user_may_access_branch(s.branch_id)
      AND private.financial_row_visible(s.id,s.branch_id,s.created_at)
      AND NOT COALESCE(s.is_archived,false)
      AND COALESCE(s.status,'') NOT IN ('cancelled','returned')
      AND (public.history_clamp_from(p_from) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=public.history_clamp_from(p_from))
      AND (public.history_clamp_to(p_to) IS NULL OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=public.history_clamp_to(p_to))
  ), movements AS MATERIALIZED (
    SELECT s.id sale_id,il.branch_id,il.raw_material_id,
      -il.quantity*GREATEST(e.sent_quantity-COALESCE(e.voided_quantity,0),0)/NULLIF(e.sent_quantity,0) quantity
    FROM scoped_sales s
    JOIN public.order_kitchen_inventory_events e ON e.settled_sale_id=s.id AND e.branch_id=s.branch_id
    JOIN public.inventory_ledger il ON il.reference_type='kitchen_send' AND il.reference_id=e.id
      AND il.entry_type='kitchen_send' AND il.branch_id=s.branch_id
    WHERE il.raw_material_id IS NOT NULL AND il.quantity<0
      AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      AND e.sent_quantity>COALESCE(e.voided_quantity,0)
      AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)
    UNION ALL
    SELECT s.id,il.branch_id,il.raw_material_id,-il.quantity
    FROM scoped_sales s JOIN public.inventory_ledger il ON il.reference_id=s.id
      AND il.reference_type='sale' AND il.entry_type='sale' AND il.branch_id=s.branch_id
    WHERE il.raw_material_id IS NOT NULL AND il.quantity<0
      AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
      -- Legacy partial refunds lack a reliable per-raw reversal link; never guess a monetary ratio.
      AND COALESCE(s.refunded_amount,0)=0
      AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_inventory_events e WHERE e.settled_sale_id=s.id AND e.branch_id=s.branch_id)
      AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)
  ), branch_raws AS MATERIALIZED (
    SELECT m.branch_id,array_agg(DISTINCT m.raw_material_id) raw_ids FROM movements m GROUP BY m.branch_id
  ), prices AS MATERIALIZED (
    SELECT p.* FROM branch_raws b CROSS JOIN LATERAL public.get_raw_material_current_prices(b.branch_id,b.raw_ids) p
  )
  SELECT m.sale_id,round(sum(m.quantity*COALESCE(p.unit_cost,0)),2),
    count(*) FILTER(WHERE p.unit_cost>0),count(*) FILTER(WHERE COALESCE(p.unit_cost,0)<=0)
  FROM movements m LEFT JOIN prices p ON p.raw_material_id=m.raw_material_id AND p.branch_id=m.branch_id
  GROUP BY m.sale_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_historical_sale_cost_estimates(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_historical_sale_cost_estimates(uuid,date,date) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
