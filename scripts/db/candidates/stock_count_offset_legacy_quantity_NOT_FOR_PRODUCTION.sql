-- Require an exact quantity bridge before using legacy debt metadata.
-- No FIFO valuation or historical sale cost writes occur here.
CREATE OR REPLACE FUNCTION private.validate_count_legacy_quantity(p_raw uuid,p_branch uuid,p_warehouse uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF EXISTS (
    WITH debt AS MATERIALIZED (
      SELECT oversold_batch_id,sum(debt_quantity-settled_quantity) qty
      FROM public.raw_fifo_debts WHERE raw_material_id=p_raw AND branch_id=p_branch
        AND warehouse_id=p_warehouse AND settled_quantity<debt_quantity GROUP BY oversold_batch_id
    ), negative AS MATERIALIZED (
      SELECT id,quantity FROM public.raw_material_batches WHERE raw_material_id=p_raw
        AND branch_id=p_branch AND warehouse_id=p_warehouse AND quantity<0
    ) SELECT 1 FROM negative b FULL JOIN debt d ON d.oversold_batch_id=b.id
      WHERE b.id IS NULL OR d.oversold_batch_id IS NULL OR -b.quantity IS DISTINCT FROM d.qty
  ) THEN RAISE EXCEPTION 'COUNT_LEGACY_QUANTITY_UNRECONCILED'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_count_legacy_quantity(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Local prototype. Call only in the same transaction as the count receipt.
-- Compatibility rows track outstanding quantity; never call the FIFO cost writer.
CREATE OR REPLACE FUNCTION private.offset_stock_count_legacy_quantity(p_receipt_id bigint,p_batch_id uuid)
RETURNS numeric LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  r public.inventory_ledger%ROWTYPE;
  b public.raw_material_batches%ROWTYPE;
  remaining numeric;
  inserted_n bigint;
  debt_n bigint;
  batch_n bigint;
  expected_batch_n bigint;
  estimate_n bigint;
  absorbed numeric:=0;
BEGIN
  SELECT * INTO STRICT r FROM public.inventory_ledger WHERE id=p_receipt_id FOR UPDATE;
  IF r.reference_type IS DISTINCT FROM 'stock_count' OR r.raw_material_id IS NULL OR r.quantity<=0 THEN
    RAISE EXCEPTION 'COUNT_RECEIPT_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.raw_material_id::text||':'||r.branch_id::text,0));
  SELECT * INTO STRICT b FROM public.raw_material_batches WHERE id=p_batch_id FOR UPDATE;
  IF ROW(b.raw_material_id,b.branch_id,b.warehouse_id,b.batch_number)
     IS DISTINCT FROM ROW(r.raw_material_id,r.branch_id,r.warehouse_id,r.batch_number) THEN
    RAISE EXCEPTION 'COUNT_RECEIPT_BATCH_MISMATCH';
  END IF;
  -- A receipt can be retried after partially settling multiple debts. Its total
  -- absorbed quantity must never exceed its original physical quantity.
  SELECT greatest(0,least(b.quantity,r.quantity-COALESCE(sum(s.quantity),0)))
    INTO remaining FROM public.raw_fifo_settlements s
    WHERE s.receipt_ledger_id=r.id;
  IF b.quantity<0 THEN RAISE EXCEPTION 'COUNT_RECEIPT_BATCH_NEGATIVE'; END IF;
  IF remaining<=0 THEN RETURN 0; END IF;
  WITH locked AS MATERIALIZED (
    SELECT f.id,f.oversold_batch_id,f.source_created_at,f.debt_quantity-f.settled_quantity outstanding
    FROM public.raw_fifo_debts f WHERE f.raw_material_id=r.raw_material_id AND f.branch_id=r.branch_id
      AND f.warehouse_id=r.warehouse_id AND f.source_created_at<=r.created_at
      AND f.settled_quantity<f.debt_quantity
      AND NOT EXISTS(SELECT 1 FROM public.raw_fifo_settlements s WHERE s.debt_id=f.id AND s.receipt_ledger_id=r.id)
    ORDER BY f.source_created_at,f.id LIMIT greatest(1,least(500,coalesce(nullif(current_setting('app.stock_count_cleanup_limit',true),''),'500')::integer)) FOR UPDATE
  ), allocation AS MATERIALIZED (
    SELECT id,oversold_batch_id,greatest(0,least(outstanding,remaining-coalesce(
      sum(outstanding) OVER(ORDER BY source_created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))) take_qty
    FROM locked
  ), inserted AS (
    INSERT INTO public.raw_fifo_settlements(debt_id,receipt_ledger_id,receipt_batch_id,quantity,unit_cost,total_cost)
    SELECT id,r.id,b.id,take_qty,0,0 FROM allocation WHERE take_qty>0
    ON CONFLICT(debt_id,receipt_ledger_id) DO NOTHING RETURNING debt_id,quantity
  ), batch_allocation AS MATERIALIZED (
    SELECT a.oversold_batch_id,sum(i.quantity) qty FROM inserted i JOIN allocation a ON a.id=i.debt_id
    GROUP BY a.oversold_batch_id
  ), batches_updated AS (
    UPDATE public.raw_material_batches n SET quantity=n.quantity+a.qty FROM batch_allocation a
    WHERE n.id=a.oversold_batch_id AND n.raw_material_id=r.raw_material_id AND n.branch_id=r.branch_id
      AND n.warehouse_id=r.warehouse_id AND n.quantity<=-a.qty RETURNING n.id
  ), debts_updated AS (
    UPDATE public.raw_fifo_debts d SET settled_quantity=d.settled_quantity+i.quantity,updated_at=clock_timestamp()
    FROM inserted i WHERE d.id=i.debt_id AND d.settled_quantity+i.quantity<=d.debt_quantity RETURNING d.id
  ), estimates_updated AS (
    UPDATE public.raw_fifo_debt_price_estimates e
      SET zero_cost_finalized_quantity=e.zero_cost_finalized_quantity+least(i.quantity,e.remaining_estimated_quantity),
          remaining_estimated_quantity=greatest(e.remaining_estimated_quantity-i.quantity,0),updated_at=clock_timestamp()
    FROM inserted i WHERE e.debt_id=i.debt_id AND e.remaining_estimated_quantity>0 RETURNING e.debt_id
  ) SELECT coalesce(sum(i.quantity),0),count(*),(SELECT count(*) FROM debts_updated),
      (SELECT count(*) FROM batches_updated),(SELECT count(*) FROM batch_allocation),(SELECT count(*) FROM estimates_updated)
    INTO absorbed,inserted_n,debt_n,batch_n,expected_batch_n,estimate_n FROM inserted i;
  IF debt_n<>inserted_n OR batch_n<>expected_batch_n THEN
    RAISE EXCEPTION 'COUNT_NEGATIVE_BATCH_UNRECONCILED';
  END IF;
  IF absorbed>0 THEN
    UPDATE public.raw_material_batches SET quantity=quantity-absorbed WHERE id=b.id AND quantity>=absorbed;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_RECEIPT_BATCH_NEGATIVE'; END IF;
  END IF;
  RETURN absorbed;
END;
$$;
REVOKE ALL ON FUNCTION private.offset_stock_count_legacy_quantity(bigint,uuid) FROM PUBLIC,anon,authenticated;
