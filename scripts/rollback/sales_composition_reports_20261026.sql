-- Restore only this candidate; fail closed if any unrelated definition changed.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $rollback$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.get_sold_recipe_consumption_report(uuid,date,date,text,text,integer,integer)'::regprocedure);
 d:=replace(d,$new$'manufactured_units',CASE WHEN p_group_by='unit' THEN COALESCE((SELECT jsonb_agg(to_jsonb(up)) FROM unit_page up),'[]'::jsonb) ELSE NULL END,
  'manufactured_unit_count',CASE WHEN p_group_by='unit' THEN (SELECT COUNT(*) FROM unit_rows) ELSE NULL END,
  'pricing_basis',CASE WHEN p_group_by='unit' THEN 'current_recipe_manufactured_units' ELSE 'current_recipe_latest_approved' END$new$,$old$'pricing_basis','current_recipe_latest_approved'$old$);
 d:=replace(d,$new$ ), unit_rows AS MATERIALIZED (
  -- Reuse the SAME sold normalization and recursive walk; no second recipe engine.
  SELECT s.branch_id,b.name branch_name,s.product_id,s.product_name,g.id inventory_unit_id,
   g.name inventory_unit_name,g.code inventory_unit_code,
   SUM(s.gross_quantity*w.multiplier) consumed_quantity,
   SUM(s.returned_quantity*w.multiplier) returned_quantity,
   SUM((s.gross_quantity-s.returned_quantity)*w.multiplier) net_quantity,
   MAX(s.gross_quantity-s.returned_quantity) product_sold_quantity
  FROM sold s JOIN walk w ON w.product_id=s.product_id AND w.branch_id=s.branch_id
  JOIN public.inventory_units g ON g.id=w.unit_id AND g.branch_id=s.branch_id
  JOIN public.branches b ON b.id=s.branch_id
  WHERE p_group_by='unit' AND w.valid AND NOT w.cycle
   AND (COALESCE(p_search,'')='' OR concat_ws(' ',g.name,g.code,s.product_name,b.name) ILIKE '%'||p_search||'%')
  GROUP BY s.branch_id,b.name,s.product_id,s.product_name,g.id,g.name,g.code
 ), unit_page AS (
  SELECT * FROM unit_rows ORDER BY branch_name,product_name,inventory_unit_name,branch_id,product_id,inventory_unit_id
  LIMIT p_page_size OFFSET (p_page::bigint*p_page_size)
 ), rows AS MATERIALIZED (
  SELECT * FROM priced_rows$new$,$old$ ), rows AS MATERIALIZED (
  SELECT * FROM priced_rows$old$);
 d:=replace(d,$new$SELECT p.* FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT DISTINCT raw_material_id FROM quantities)) p WHERE p_group_by<>'unit'$new$,$old$SELECT p.* FROM public.get_raw_material_current_prices(p_branch_id,ARRAY(SELECT DISTINCT raw_material_id FROM quantities)) p$old$);
 d:=replace(d,$new$WHERE p_group_by<>'unit' AND NOT r.invalid AND r.raw_material_id IS NOT NULL$new$,$old$WHERE NOT r.invalid AND r.raw_material_id IS NOT NULL$old$);
 d:=replace(d,$new$p_group_by NOT IN ('material','product','unit')$new$,$old$p_group_by NOT IN ('material','product')$old$);
 IF md5(d)<>'467c0cc51b69c456fb1921aad4b19f57' THEN RAISE EXCEPTION 'SOLD_RECIPE_ROLLBACK_DRIFT';END IF;
 EXECUTE d;
 d:=pg_get_functiondef('public._operational_report_source_result(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure);
 d:=replace(d,'si.total,si.refunded_quantity,si.refunded_amount,si.source_order_item_id,si.bonus_quantity,si.modifiers_snapshot,si.modifier_option_ids','si.total,si.refunded_quantity,si.refunded_amount,si.source_order_item_id');
 IF md5(d)<>'a58b8de62008d92dc6c3c8dfd428e0bc' THEN RAISE EXCEPTION 'SALES_SOURCE_ROLLBACK_DRIFT';END IF;
 EXECUTE d;
END $rollback$;
NOTIFY pgrst,'reload schema';
COMMIT;
