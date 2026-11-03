BEGIN;
SET LOCAL lock_timeout='1s';
CREATE OR REPLACE FUNCTION public.get_operational_stock_source(p_branch_id uuid DEFAULT NULL::uuid, p_warehouse_id uuid DEFAULT NULL::uuid, p_low_stock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_count bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF p_low_stock IS NULL OR (p_low_stock AND p_warehouse_id IS NOT NULL) THEN RAISE EXCEPTION 'REPORT_FILTERS_INVALID'; END IF;
 WITH raw_balances AS MATERIALIZED (
   SELECT raw_material_id,branch_id,CASE WHEN p_low_stock THEN NULL::uuid ELSE warehouse_id END AS warehouse_id,coalesce(sum(quantity),0) AS quantity
   FROM public.raw_material_batches
   WHERE (p_branch_id IS NULL OR branch_id=p_branch_id)
     AND (p_warehouse_id IS NULL OR warehouse_id=p_warehouse_id)
   GROUP BY raw_material_id,branch_id,CASE WHEN p_low_stock THEN NULL::uuid ELSE warehouse_id END
   LIMIT 5001
 ), unit_balances AS MATERIALIZED (
   SELECT unit_id,branch_id,CASE WHEN p_low_stock THEN NULL::uuid ELSE warehouse_id END AS warehouse_id,coalesce(sum(quantity),0) AS quantity
   FROM public.inventory_unit_batches
   WHERE (p_branch_id IS NULL OR branch_id=p_branch_id)
     AND (p_warehouse_id IS NULL OR warehouse_id=p_warehouse_id)
   GROUP BY unit_id,branch_id,CASE WHEN p_low_stock THEN NULL::uuid ELSE warehouse_id END
   LIMIT 5001
 )
 SELECT jsonb_build_object(
   'rawRows', CASE WHEN p_low_stock THEN '[]'::jsonb ELSE coalesce((
     SELECT jsonb_agg(jsonb_build_object('raw_material_id',b.raw_material_id,'branch_id',b.branch_id,'warehouse_id',b.warehouse_id,'quantity',b.quantity,
       'raw_material',CASE WHEN rm.id IS NULL THEN NULL ELSE jsonb_build_object('id',rm.id,'name',rm.name,'code',rm.code,'min_stock',rm.min_stock) END,
       'warehouse',CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('name',w.name) END) ORDER BY b.branch_id,b.warehouse_id,b.raw_material_id)
     FROM raw_balances b LEFT JOIN public.raw_materials rm ON rm.id=b.raw_material_id
     LEFT JOIN public.warehouses w ON w.id=b.warehouse_id),'[]'::jsonb) END,
   'unitRows', CASE WHEN p_low_stock THEN '[]'::jsonb ELSE coalesce((
     SELECT jsonb_agg(jsonb_build_object('unit_id',b.unit_id,'branch_id',b.branch_id,'warehouse_id',b.warehouse_id,'quantity',b.quantity,
       'unit',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'name',u.name,'barcode',u.barcode,'min_stock',u.min_stock,'low_stock_threshold',u.low_stock_threshold) END,
       'warehouse',CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('name',w.name) END) ORDER BY b.branch_id,b.warehouse_id,b.unit_id)
     FROM unit_balances b LEFT JOIN public.inventory_units u ON u.id=b.unit_id
     LEFT JOIN public.warehouses w ON w.id=b.warehouse_id),'[]'::jsonb) END,
   'rawMasters', CASE WHEN NOT p_low_stock THEN '[]'::jsonb ELSE coalesce((
     SELECT jsonb_agg(jsonb_build_object('id',id,'branch_id',branch_id,'name',name,'code',code,'min_stock',min_stock,'is_active',is_active) ORDER BY branch_id,id)
     FROM (SELECT * FROM public.raw_materials WHERE is_active AND (p_branch_id IS NULL OR branch_id=p_branch_id) LIMIT 5001) rm),'[]'::jsonb) END,
   'rawBalances', CASE WHEN NOT p_low_stock THEN '[]'::jsonb ELSE coalesce((
     SELECT jsonb_agg(to_jsonb(b) ORDER BY b.branch_id,b.raw_material_id)
     FROM (SELECT raw_material_id,branch_id,sum(quantity) AS quantity FROM raw_balances GROUP BY raw_material_id,branch_id) b),'[]'::jsonb) END,
   'unitMasters', CASE WHEN NOT p_low_stock THEN '[]'::jsonb ELSE coalesce((
     SELECT jsonb_agg(jsonb_build_object('id',id,'branch_id',branch_id,'name',name,'barcode',barcode,'min_stock',min_stock,'low_stock_threshold',low_stock_threshold,'is_active',is_active) ORDER BY branch_id,id)
     FROM (SELECT * FROM public.inventory_units WHERE is_active AND (p_branch_id IS NULL OR branch_id=p_branch_id) LIMIT 5001) u),'[]'::jsonb) END,
   'unitBatches', CASE WHEN NOT p_low_stock THEN '[]'::jsonb ELSE coalesce((
     SELECT jsonb_agg(to_jsonb(b) ORDER BY b.branch_id,b.unit_id)
     FROM (SELECT unit_id,branch_id,sum(quantity) AS quantity FROM unit_balances GROUP BY unit_id,branch_id) b),'[]'::jsonb) END
 ) INTO v_result;
 SELECT sum(jsonb_array_length(value)) INTO v_count FROM jsonb_each(v_result);
 IF v_count>5000 THEN RAISE EXCEPTION 'REPORT_SOURCE_LIMIT'; END IF;
 RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_raw_material_latest_valuation(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(raw_material_id uuid, raw_material_name text, raw_material_code text, branch_id uuid, latest_cost numeric, previous_cost numeric, change_amount numeric, change_pct numeric, price_source text, priced_at timestamp with time zone, reference_number text, source_detail text, event_count bigint, stock_quantity numeric, positive_quantity numeric, negative_quantity numeric, actual_stock_value numeric, estimated_negative_value numeric, unpriced_negative_quantity numeric, estimated_net_stock_value numeric, price_missing boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 IF NOT public.can_permission('reports.costing') THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
 IF p_branch_id IS NOT NULL AND NOT public.user_may_access_branch(p_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
 RETURN QUERY
 WITH materials AS MATERIALIZED (
  SELECT rm.id,rm.name,rm.code,rm.branch_id,COALESCE(ri.quantity,0)::numeric qty
  FROM public.raw_materials rm LEFT JOIN public.raw_material_inventory ri ON ri.raw_material_id=rm.id AND ri.branch_id=rm.branch_id
  WHERE (p_branch_id IS NULL OR rm.branch_id=p_branch_id) AND public.user_may_access_branch(rm.branch_id)
 ), prices AS MATERIALIZED (
  SELECT cp.* FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT m.id FROM materials m)) cp
 )
 SELECT m.id,m.name::text,m.code::text,m.branch_id,COALESCE(cp.unit_cost,0),NULL::numeric,NULL::numeric,NULL::numeric,
  COALESCE(cp.price_source,'unpriced')::text,cp.priced_at,cp.reference_number,'latest_approved'::text,0::bigint,m.qty,
  greatest(m.qty,0),greatest(-m.qty,0),COALESCE(round(greatest(m.qty,0)*cp.unit_cost,2),0),
  COALESCE(round(greatest(-m.qty,0)*cp.unit_cost,2),0),CASE WHEN cp.unit_cost IS NULL THEN greatest(-m.qty,0) ELSE 0 END,
  COALESCE(round(m.qty*cp.unit_cost,2),0),cp.unit_cost IS NULL
 FROM materials m LEFT JOIN prices cp ON cp.raw_material_id=m.id AND cp.branch_id=m.branch_id ORDER BY m.name,m.id;
END $function$;
DROP VIEW private.raw_stock_quantities;
COMMIT;
