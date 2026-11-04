-- Compatibility API keeps its authorization and JSON contract. After branch
-- cutover it uses the shared balance/price projection, without FIFO health scans.
DO $valuation_compatibility$
DECLARE s text; old text:='  RETURN ('; newer text;
BEGIN
 SELECT pg_get_functiondef('public.get_current_raw_material_valuation(uuid)'::regprocedure) INTO s;
 IF md5(s)<>'03833ef5b80d88cab0834735f1b1c462' THEN RAISE EXCEPTION 'RAW_VALUATION_COMPATIBILITY_SOURCE_DRIFT'; END IF;
 newer:=$new$  IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates a
   WHERE a.branch_id=p_branch_id AND a.warehouse_id IS NULL) THEN
   RETURN (
    WITH quantities AS MATERIALIZED(SELECT raw_material_id,sum(quantity) quantity
     FROM private.raw_stock_quantities WHERE branch_id=p_branch_id GROUP BY raw_material_id),
    prices AS MATERIALIZED(SELECT * FROM private.stock_count_raw_price(p_branch_id,NULL,NULL))
    SELECT coalesce(jsonb_agg(jsonb_build_object(
     'raw_material_id',rm.id,'raw_material_name',rm.name,'raw_material_code',rm.code,
     'unit_name',coalesce(u.name,''),'current_quantity',coalesce(q.quantity,0),
     'fifo_current_unit_cost',coalesce(p.unit_cost,0),
     'current_inventory_value',round(coalesce(q.quantity,0)*coalesce(p.unit_cost,0),2),
     'latest_authoritative_cost',coalesce(p.unit_cost,0),'price_source',p.price_source,'priced_at',p.priced_at,
     'valuation_basis','last_approved_price','open_fifo_batches',0,
     'outstanding_fifo_debt_quantity',0,'outstanding_fifo_debt_rows',0,
     'fifo_debt_warehouse_count',0,'fifo_debt_warehouses_without_receipt_history',0,
     'unpriced_fifo_debt_quantity',0,'fifo_debt_estimated_unit_cost',0,
     'estimated_fifo_debt_value',0,'fifo_debt_pricing_coverage_pct',100,
     'has_unpriced_fifo_debt',false,'has_missing_purchase_receipt_history',false,'fifo_debt_status','RETIRED'
    ) ORDER BY rm.name),'[]'::jsonb)
    FROM public.raw_materials rm LEFT JOIN quantities q ON q.raw_material_id=rm.id
    LEFT JOIN prices p ON p.raw_material_id=rm.id LEFT JOIN public.units u ON u.id=rm.unit_id
    WHERE rm.branch_id=p_branch_id AND(rm.is_active OR coalesce(q.quantity,0)<>0)
   );
  END IF;

$new$||old;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'RAW_VALUATION_RETURN_DRIFT'; END IF;
 EXECUTE replace(s,old,newer);
END $valuation_compatibility$;

-- Old administrative replay tools remain for unconverted historical rehearsal;
-- they cannot prepare/apply/reverse a cost replay once cutover has started.
DO $retire_replay$
DECLARE f record; s text; old text:=chr(10)||'BEGIN'||chr(10); newer text;
BEGIN
 newer:=old||$new$ IF EXISTS(SELECT 1 FROM private.raw_cost_v2_activated_coordinates) THEN
  RAISE EXCEPTION 'FIFO_RETIRED_USE_LAST_PRICE';
 END IF;
$new$;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN('raw_fifo_prepare_backfill','raw_fifo_apply_backfill',
   'raw_fifo_reverse_backfill','raw_fifo_price_fallback_prepare','raw_fifo_price_fallback_apply',
   'raw_fifo_price_fallback_reverse','raw_opening_cost_apply_repair','raw_opening_cost_reverse_repair')
 LOOP
  SELECT pg_get_functiondef(f.oid) INTO s;
  IF position(old IN s)=0 THEN RAISE EXCEPTION 'FIFO_REPLAY_ENTRY_DRIFT'; END IF;
  EXECUTE overlay(s placing newer from position(old IN s) for length(old));
 END LOOP;
END $retire_replay$;
