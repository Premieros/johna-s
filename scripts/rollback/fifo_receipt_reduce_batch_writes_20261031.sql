-- Rollback-only function change. Do not execute unless this isolated
-- receipt write-consolidation patch was explicitly installed and rollback
-- has been approved. No inventory rows, FIFO debts, journals or batches
-- are directly modified by this schema-only script.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $rollback_fifo_receipt_write_once$
DECLARE v_sql text; v_old text; v_new text;
BEGIN
  SELECT replace(pg_get_functiondef('public._raw_fifo_settle_receipt(bigint,uuid,uuid)'::regprocedure),chr(13),'')
  INTO STRICT v_sql;
  IF position('FIFO_RECEIPT_BATCH_WRITE_ONCE_V1' IN v_sql)=0
     OR position('SECURITY DEFINER' IN v_sql)=0 THEN
    RAISE EXCEPTION 'FIFO_RECEIPT_ROLLBACK_UNEXPECTED_SOURCE';
  END IF;

  v_old:=$old$  v_total_adjustment numeric(18,6):=0;
  v_pending_receipt numeric(18,6):=0;$old$;
  v_new:=$new$  v_total_adjustment numeric(18,6):=0;$new$;
  IF (length(v_sql)-length(replace(v_sql,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'FIFO_RECEIPT_ROLLBACK_DECLARE_DRIFT';
  END IF;
  v_sql:=replace(v_sql,v_old,v_new);

  v_old:=$old$    -- FIFO_RECEIPT_BATCH_WRITE_ONCE_V1: postpone redundant writes only
    -- for sale/kitchen sources that cannot consume this receipt's stock.
    -- Other propagation, especially production/transfers, needs up-to-date
    -- receipt balance before calling its recursive writer.
    v_pending_receipt:=v_pending_receipt+v_take;
    IF v_source.reference_type IS NULL
       OR v_source.reference_type NOT IN ('sale','kitchen_send') THEN
      UPDATE public.raw_material_batches
      SET quantity=GREATEST(quantity-v_pending_receipt,0)
      WHERE id=v_batch.id;
      v_pending_receipt:=0;
    END IF;

    UPDATE public.inventory_ledger$old$;
  v_new:=$new$    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_take,0)
    WHERE id=v_batch.id;

    UPDATE public.inventory_ledger$new$;
  IF (length(v_sql)-length(replace(v_sql,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'FIFO_RECEIPT_ROLLBACK_UPDATE_DRIFT';
  END IF;
  v_sql:=replace(v_sql,v_old,v_new);

  v_old:=$old$  END LOOP;

  -- One receipt batch write after all sale/kitchen reconciliations; failure
  -- rolls back this change with the whole existing receipt transaction.
  IF v_pending_receipt>0 THEN
    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_pending_receipt,0)
    WHERE id=v_batch.id;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,$old$;
  v_new:=$new$  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,$new$;
  IF (length(v_sql)-length(replace(v_sql,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'FIFO_RECEIPT_ROLLBACK_FLUSH_DRIFT';
  END IF;
  v_sql:=replace(v_sql,v_old,v_new);

  EXECUTE v_sql;
END;
$rollback_fifo_receipt_write_once$;
COMMIT;
