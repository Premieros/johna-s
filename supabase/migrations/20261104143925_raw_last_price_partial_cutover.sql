-- Preserve the exact old money/settlement history for a provable zero-basis partial.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $$ BEGIN IF md5(pg_get_functiondef('private.activate_raw_last_price_coordinate(uuid,uuid,uuid,numeric,integer,numeric)'::regprocedure))<>'756cd7af43d15b48d6e1bdfdd1e1f219' THEN RAISE EXCEPTION 'PARTIAL_CUTOVER_BASELINE_DRIFT'; END IF; END $$;
-- CANDIDATE ONLY. Owner-only, bounded, audited quantity conversion. Not a
-- production migration. No source cost, sale, journal or settlement rewrite.
CREATE OR REPLACE FUNCTION private.activate_raw_last_price_coordinate(
 p_branch uuid,p_warehouse uuid,p_raw uuid,p_expected_quantity numeric,
 p_expected_debts integer,p_expected_debt_quantity numeric
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid(); before_qty numeric; after_qty numeric;
 debt_count integer; partial_count integer; debt_qty numeric; basis numeric; negative_qty numeric;
 debt_ids uuid[]; batch_ids uuid[]; new_batch uuid; changed integer;
BEGIN
 IF actor IS NULL OR NOT public.can_permission('inventory.count.apply')
  OR NOT public.user_may_access_branch(p_branch) THEN RAISE EXCEPTION 'CUTOVER_NOT_ALLOWED'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_debts IS NULL OR p_expected_debts<0
  OR p_expected_debts>500 OR p_expected_debt_quantity IS NULL OR p_expected_debt_quantity<0
  THEN RAISE EXCEPTION 'CUTOVER_INVALID_SNAPSHOT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=p_warehouse AND branch_id=p_branch AND is_active)
  OR NOT EXISTS(SELECT 1 FROM public.raw_materials WHERE id=p_raw AND branch_id=p_branch)
  THEN RAISE EXCEPTION 'CUTOVER_BRANCH_MISMATCH'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_raw::text||':'||p_branch::text,0))
  THEN RAISE EXCEPTION 'CUTOVER_STOCK_BUSY'; END IF;
 IF private.raw_last_price_enabled(p_branch,p_warehouse,p_raw) THEN
  RETURN jsonb_build_object('success',true,'already_active',true);
 END IF;
 SELECT coalesce(sum(quantity),0) INTO before_qty FROM public.raw_material_batches
  WHERE branch_id=p_branch AND warehouse_id=p_warehouse AND raw_material_id=p_raw;
 IF before_qty IS DISTINCT FROM p_expected_quantity THEN RAISE EXCEPTION 'CUTOVER_STOCK_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.raw_material_batches WHERE branch_id=p_branch
  AND warehouse_id=p_warehouse AND raw_material_id=p_raw AND source_type='approved_shortage_aggregate')
  THEN RAISE EXCEPTION 'CUTOVER_APPROVED_STATE_WITHOUT_MARKER'; END IF;

 SELECT count(*),count(*) FILTER(WHERE d.settled_quantity<>0),coalesce(sum(d.debt_quantity-d.settled_quantity),0),array_agg(d.id ORDER BY d.id)
 INTO debt_count,partial_count,debt_qty,debt_ids FROM (
  SELECT d.* FROM public.raw_fifo_debts d WHERE d.branch_id=p_branch
   AND d.warehouse_id=p_warehouse AND d.raw_material_id=p_raw
   AND d.settled_quantity<d.debt_quantity AND d.approved_converted_at IS NULL
   ORDER BY d.id LIMIT 501 FOR UPDATE
 ) d;
 IF debt_count>500 OR debt_count IS DISTINCT FROM p_expected_debts
  OR debt_qty IS DISTINCT FROM p_expected_debt_quantity THEN RAISE EXCEPTION 'CUTOVER_DEBT_CHANGED'; END IF;
 PERFORM 1 FROM public.inventory_ledger s JOIN public.raw_fifo_debts d ON d.source_ledger_id=s.id
  WHERE d.id=ANY(debt_ids) ORDER BY s.id FOR UPDATE OF s;
 -- A legacy partial source is convertible only when its entire recorded money
 -- is explained by applied settlements. Its remaining recognized basis is0;
 -- using the source weighted unit cost again would double count settled cost.
 IF EXISTS(
  SELECT 1 FROM public.raw_fifo_debts d
  LEFT JOIN public.inventory_ledger s ON s.id=d.source_ledger_id
  LEFT JOIN LATERAL(SELECT sum(t.quantity) qty,sum(t.total_cost) cost,
   bool_and(t.reconciliation_status IS NOT DISTINCT FROM 'applied'
    AND t.quantity>0 AND t.unit_cost>=0 AND t.total_cost>=0) valid
   FROM public.raw_fifo_settlements t WHERE t.debt_id=d.id) settled ON true
  WHERE d.id=ANY(debt_ids) AND d.settled_quantity<>0
   AND (s.id IS NULL OR s.approved_cost_basis IS NOT NULL
    OR s.quantity IS DISTINCT FROM -d.debt_quantity
    OR settled.valid IS NOT TRUE OR settled.qty IS DISTINCT FROM d.settled_quantity
    OR round(settled.cost,2) IS DISTINCT FROM -s.total_cost
    OR round(settled.cost/d.debt_quantity,6) IS DISTINCT FROM s.unit_cost)
 ) THEN RAISE EXCEPTION 'CUTOVER_PARTIAL_POSITION_REQUIRES_RECONCILIATION'; END IF;

 IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d LEFT JOIN public.inventory_ledger s ON s.id=d.source_ledger_id
  WHERE d.id=ANY(debt_ids) AND (s.id IS NULL OR s.raw_material_id IS DISTINCT FROM p_raw
   OR s.branch_id IS DISTINCT FROM p_branch OR s.warehouse_id IS DISTINCT FROM p_warehouse
   OR s.quantity>=0 OR abs(s.quantity)<d.debt_quantity OR s.unit_cost<0
   OR s.total_cost>0 OR (s.approved_cost_basis IS DISTINCT FROM 'approved_last_known'
    AND d.settled_quantity=0 AND (s.unit_cost<>0 OR s.total_cost<>0))))
  THEN RAISE EXCEPTION 'CUTOVER_SOURCE_COST_REQUIRES_RECONCILIATION'; END IF;
 SELECT coalesce(sum(CASE WHEN s.approved_cost_basis='approved_last_known'
  THEN (d.debt_quantity-d.settled_quantity)*s.unit_cost ELSE 0 END),0) INTO basis
 FROM public.raw_fifo_debts d JOIN public.inventory_ledger s ON s.id=d.source_ledger_id
 WHERE d.id=ANY(debt_ids);

 PERFORM 1 FROM public.raw_material_batches b WHERE b.branch_id=p_branch
  AND b.warehouse_id=p_warehouse AND b.raw_material_id=p_raw AND b.quantity<0
  ORDER BY b.id FOR UPDATE;
 SELECT coalesce(-sum(quantity),0),array_agg(id ORDER BY id) INTO negative_qty,batch_ids
 FROM public.raw_material_batches WHERE branch_id=p_branch AND warehouse_id=p_warehouse
  AND raw_material_id=p_raw AND quantity<0;
 IF negative_qty IS DISTINCT FROM debt_qty OR EXISTS(
  WITH d AS(SELECT oversold_batch_id,sum(debt_quantity-settled_quantity) q FROM public.raw_fifo_debts
   WHERE id=ANY(debt_ids) GROUP BY oversold_batch_id)
  SELECT 1 FROM public.raw_material_batches b FULL JOIN d ON d.oversold_batch_id=b.id
  WHERE (b.id=ANY(batch_ids) OR d.oversold_batch_id IS NOT NULL)
   AND (b.id IS NULL OR d.oversold_batch_id IS NULL OR b.quantity IS DISTINCT FROM -d.q)
 ) THEN RAISE EXCEPTION 'CUTOVER_QUANTITY_UNRECONCILED'; END IF;
 IF debt_qty>0 THEN
  INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,
   quantity,unit_cost,source_type,approved_shortage_total_cost)
  VALUES(p_raw,p_branch,p_warehouse,'AS-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
   -debt_qty,basis/debt_qty,'approved_shortage_aggregate',basis) RETURNING id INTO new_batch;
  UPDATE public.raw_material_batches SET quantity=0 WHERE id=ANY(batch_ids);
  UPDATE public.raw_fifo_debts SET approved_conversion_batch_id=new_batch,
   approved_converted_at=statement_timestamp() WHERE id=ANY(debt_ids) AND approved_converted_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>debt_count THEN RAISE EXCEPTION 'CUTOVER_DEBT_WRITE_MISMATCH'; END IF;
 END IF;
 SELECT coalesce(sum(quantity),0) INTO after_qty FROM public.raw_material_batches
  WHERE branch_id=p_branch AND warehouse_id=p_warehouse AND raw_material_id=p_raw;
 IF after_qty IS DISTINCT FROM before_qty THEN RAISE EXCEPTION 'CUTOVER_CHANGED_NET_STOCK'; END IF;
 INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,warehouse_id,raw_material_id,activation_note)
 VALUES(p_branch,p_warehouse,p_raw,'audited legacy quantity conversion; source costs and journals retained');
 INSERT INTO public.audit_log(user_id,action,entity,entity_id,branch_id,details)
 VALUES(actor,'update','raw_materials',p_raw,p_branch,jsonb_build_object(
  'kind','raw_last_price_coordinate_cutover','warehouse_id',p_warehouse,
  'quantity_before',before_qty,'quantity_after',after_qty,'debt_quantity',debt_qty,
  'frozen_shortage_basis',basis,'legacy_debt_ids',debt_ids,'legacy_batch_ids',batch_ids,
  'aggregate_batch_id',new_batch,'legacy_settled_quantity_unchanged',true,'partial_legacy_debts_preserved',partial_count));
 RETURN jsonb_build_object('success',true,'already_active',false,'quantity',after_qty,
  'converted_debts',debt_count,'shortage_quantity',debt_qty,'frozen_basis',basis,
  'partial_legacy_debts_preserved',partial_count);
END;
$$;
REVOKE ALL ON FUNCTION private.activate_raw_last_price_coordinate(uuid,uuid,uuid,numeric,integer,numeric)
 FROM PUBLIC,anon,authenticated,service_role;


COMMIT;
