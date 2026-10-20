-- Development candidate. No production apply without the release gate.
SET lock_timeout='2s';
SET statement_timeout='15s';
-- The existing price projection and its RLS remain the source; FIFO is not read.
CREATE FUNCTION public.get_consumption_latest_report(
 p_branch_id uuid, p_from_date date, p_to_date date, p_group_by text DEFAULT 'material',
 p_search text DEFAULT '', p_include_waste boolean DEFAULT false,
 p_page integer DEFAULT 0, p_page_size integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp AS $function$
DECLARE v_from date:=public.history_clamp_from(p_from_date);
 v_to date:=public.history_clamp_to(p_to_date); v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT (public.can_permission('reports.view') AND public.can_permission('reports.costing')) THEN
  RAISE EXCEPTION 'PERMISSION_DENIED:reports.costing'; END IF;
 IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN
  RAISE EXCEPTION 'BRANCH_ACCESS_DENIED'; END IF;
 IF v_from IS NULL OR v_to IS NULL OR v_to<v_from OR v_to-v_from>366 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
 IF p_group_by IS NULL OR p_group_by NOT IN ('material','product') OR p_page IS NULL OR p_page<0
  OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_REPORT_OPTIONS'; END IF;
 WITH movements AS MATERIALIZED (
  SELECT il.branch_id,il.raw_material_id,il.quantity,
   CASE WHEN p_group_by='product' THEN oi.product_id END AS product_id,
   il.entry_type
  FROM public.inventory_ledger il
  LEFT JOIN public.order_kitchen_inventory_events e ON il.reference_type='kitchen_send'
   AND e.id=il.reference_id AND e.branch_id=il.branch_id
  LEFT JOIN public.order_items oi ON oi.id=e.order_item_id AND oi.order_id=e.order_id
  WHERE (p_branch_id IS NULL OR il.branch_id=p_branch_id)
   AND public.user_may_access_branch(il.branch_id)
   AND il.raw_material_id IS NOT NULL
   AND il.created_at >= (v_from::timestamp AT TIME ZONE 'Africa/Cairo')
   AND il.created_at < ((v_to+1)::timestamp AT TIME ZONE 'Africa/Cairo')
   AND ((il.entry_type IN ('sale','kitchen_send') AND il.reference_type IN ('sale','kitchen_send'))
    OR (il.entry_type IN ('refund','kitchen_void') AND il.reference_type IN ('sale','refund','kitchen_send'))
    OR (p_include_waste AND il.entry_type='waste'))
   AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)
 ), quantities AS MATERIALIZED (
  SELECT branch_id,raw_material_id,product_id,
   sum(CASE WHEN entry_type IN ('sale','kitchen_send') AND quantity<0 THEN -quantity ELSE 0 END) consumed_quantity,
   sum(CASE WHEN entry_type IN ('refund','kitchen_void') AND quantity>0 THEN quantity ELSE 0 END) returned_quantity,
   sum(CASE WHEN entry_type='waste' AND quantity<0 THEN -quantity ELSE 0 END) waste_quantity
  FROM movements GROUP BY branch_id,raw_material_id,product_id
 ), materials AS MATERIALIZED (
  SELECT DISTINCT branch_id,raw_material_id FROM quantities
 ), prices AS MATERIALIZED (
  SELECT cp.* FROM public.get_raw_material_current_prices(
   p_branch_id,ARRAY(SELECT DISTINCT raw_material_id FROM materials)
  ) cp
 ), rows AS MATERIALIZED (
  SELECT q.branch_id,q.raw_material_id,pr.id product_id,b.name branch_name,rm.name raw_material_name,rm.code raw_material_code,
   pr.name product_name,COALESCE(mu.symbol,mu.code,mu.name,'') unit_name,
   q.consumed_quantity,q.returned_quantity,q.waste_quantity,
   q.consumed_quantity-q.returned_quantity+q.waste_quantity net_quantity,
   COALESCE(cp.unit_cost,0) unit_price,COALESCE(cp.price_source,'unpriced') price_source,cp.priced_at price_date,cp.reference_number price_reference,
   (q.consumed_quantity-q.returned_quantity+q.waste_quantity)*COALESCE(cp.unit_cost,0) consumption_value,
   cp.unit_cost IS NULL price_missing
  FROM quantities q JOIN public.raw_materials rm ON rm.id=q.raw_material_id AND rm.branch_id=q.branch_id
  JOIN public.branches b ON b.id=q.branch_id
  LEFT JOIN public.measurement_units mu ON mu.id=rm.unit_id
  LEFT JOIN public.products pr ON pr.id=q.product_id AND pr.branch_id=q.branch_id
  LEFT JOIN prices cp ON cp.branch_id=q.branch_id AND cp.raw_material_id=q.raw_material_id
  WHERE (COALESCE(p_search,'')='' OR concat_ws(' ',rm.name,rm.code,pr.name,b.name) ILIKE '%'||p_search||'%')
   AND (q.consumed_quantity<>0 OR q.returned_quantity<>0 OR q.waste_quantity<>0)
 ), page AS (
  SELECT * FROM rows ORDER BY branch_name,COALESCE(product_name,''),raw_material_name,branch_id,product_id NULLS FIRST,raw_material_id
  LIMIT p_page_size OFFSET (p_page::bigint*p_page_size)
 )
 SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM page p),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('count',count(*),'total',round(COALESCE(sum(consumption_value),0),2),
   'unpriced_count',count(*) FILTER(WHERE price_missing),
   'unattributed_count',count(*) FILTER(WHERE p_group_by='product' AND product_id IS NULL),
   'complete',count(*) FILTER(WHERE price_missing)=0) FROM rows),
  'pricing_basis','latest_approved','from',v_from,'to',v_to,'generated_at',statement_timestamp()) INTO v_result;
 RETURN v_result;
END $function$;
REVOKE ALL ON FUNCTION public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer) TO authenticated;

-- Edit only the creation checks in existing guarded functions. Do not replace
-- writers, money calculations, RLS, triggers, action contexts or print paths.
DO $quick_permission$
DECLARE v_def text; v_old text; v_new text;
BEGIN
 v_def:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure);
 v_old:='IF NOT public.can_permission(''pos.order.create'') THEN';
 v_new:='IF NOT public.can_permission(''pos.order.create'') AND NOT (public.can_permission(''pos.order.quick_create'') AND COALESCE(p_order_type=''takeaway'' AND p_table_id IS NULL AND (public.can_permission(''pos.discount'') OR (COALESCE(p_discount_amount,0)=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi WHERE COALESCE((qi->>''discount_amount'')::numeric,0)<>0 OR COALESCE((qi->>''bonus_quantity'')::numeric,0)<>0))),false)) THEN';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'QUICK_CREATE_RPC_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(v_def,v_old,v_new);
 v_def:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure);
 v_old:='IF NOT public.can_permission(''pos.order.create'') THEN';
 v_new:='IF NOT public.can_permission(''pos.order.create'') AND NOT (public.can_permission(''pos.order.quick_create'') AND COALESCE(NEW.order_type=''takeaway'' AND NEW.table_id IS NULL AND NEW.status=''open'' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission(''pos.discount'')) AND NEW.cashier_id=auth.uid() AND public.user_may_access_branch(NEW.branch_id),false)) THEN';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'QUICK_CREATE_TRIGGER_BASELINE_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='IF NOT public.can_permission(''pos.order.create'') AND NOT public.can_permission(''pos.order.edit'') THEN';
 v_new:='IF NOT public.can_permission(''pos.order.create'') AND NOT public.can_permission(''pos.order.edit'') AND NOT (public.can_permission(''pos.order.quick_create'') AND (public.can_permission(''pos.discount'') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0)) AND EXISTS(SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id AND qo.order_type=''takeaway'' AND qo.table_id IS NULL AND qo.cashier_id=auth.uid() AND qo.status=''open'' AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id))) THEN';
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'QUICK_CREATE_ITEMS_BASELINE_MISMATCH'; END IF;
 v_def:=replace(v_def,v_old,v_new);
 -- Item inserts synchronously recalculate this just-created order. Authorize
 -- only that nested trigger's totals; this never grants generic order editing.
 v_old:='    v_print_only_mutation :=';
 v_new:=$body$    IF pg_trigger_depth()>1
       AND public.can_permission('pos.order.quick_create')
       AND OLD.order_type='takeaway' AND OLD.table_id IS NULL
       AND OLD.cashier_id=auth.uid() AND OLD.status='open'
       AND OLD.created_at>=transaction_timestamp()
       AND public.user_may_access_branch(OLD.branch_id)
       AND (to_jsonb(NEW)-ARRAY['subtotal','discount_amount','tax_amount','total','updated_at']::text[])
         = (to_jsonb(OLD)-ARRAY['subtotal','discount_amount','tax_amount','total','updated_at']::text[]) THEN
      RETURN NEW;
    END IF;
    v_print_only_mutation :=$body$;
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'QUICK_CREATE_TOTALS_BASELINE_MISMATCH'; END IF;
 EXECUTE replace(v_def,v_old,v_new);
END $quick_permission$;
NOTIFY pgrst,'reload schema';
