-- CANDIDATE ONLY. Retain count effective dates and the existing quantity source.
-- Ignore explicitly archived legacy positions; aggregate shortage is already
-- included in the same signed-batch SUM and must not require a fake FIFO debt.
CREATE OR REPLACE FUNCTION private.validate_count_legacy_quantity(p_raw uuid,p_branch uuid,p_warehouse uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(
  WITH debt AS MATERIALIZED(
   SELECT oversold_batch_id,sum(debt_quantity-settled_quantity) qty
   FROM public.raw_fifo_debts WHERE raw_material_id=p_raw AND branch_id=p_branch
    AND warehouse_id=p_warehouse AND settled_quantity<debt_quantity AND approved_converted_at IS NULL
   GROUP BY oversold_batch_id
  ),negative AS MATERIALIZED(
   SELECT id,quantity FROM public.raw_material_batches WHERE raw_material_id=p_raw
    AND branch_id=p_branch AND warehouse_id=p_warehouse AND quantity<0
    AND source_type<>'approved_shortage_aggregate'
  ) SELECT 1 FROM negative b FULL JOIN debt d ON d.oversold_batch_id=b.id
   WHERE b.id IS NULL OR d.oversold_batch_id IS NULL OR -b.quantity IS DISTINCT FROM d.qty
 ) THEN RAISE EXCEPTION 'COUNT_LEGACY_QUANTITY_UNRECONCILED'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_count_legacy_quantity(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $count_group_validation$
DECLARE s text; old text; newer text;
BEGIN
 SELECT pg_get_functiondef('private.apply_raw_stock_count_last_price(uuid)'::regprocedure) INTO s;
 old:='AND d.settled_quantity<d.debt_quantity';
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'APPROVED_COUNT_DEBT_SOURCE_DRIFT'; END IF;
 s:=replace(s,old,old||' AND d.approved_converted_at IS NULL');
 old:='AND b.warehouse_id=v_count.warehouse_id AND b.quantity<0';
 newer:=old||' AND b.source_type<>''approved_shortage_aggregate''';
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'APPROVED_COUNT_BATCH_SOURCE_DRIFT'; END IF;
 EXECUTE replace(s,old,newer);
END $count_group_validation$;

DO $count_cleanup_archives$
DECLARE s text; old text:='AND f.settled_quantity<f.debt_quantity';
BEGIN
 SELECT pg_get_functiondef('private.offset_stock_count_legacy_quantity(bigint,uuid)'::regprocedure) INTO s;
 IF (length(s)-length(replace(s,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'APPROVED_COUNT_CLEANUP_SOURCE_DRIFT'; END IF;
 EXECUTE replace(s,old,old||' AND f.approved_converted_at IS NULL');
END $count_cleanup_archives$;
