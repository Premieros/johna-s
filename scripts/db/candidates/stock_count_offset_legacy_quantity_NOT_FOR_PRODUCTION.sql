-- Local prototype. Call only in the same transaction as the count receipt.
-- Compatibility rows track outstanding quantity; never call the FIFO cost writer.
CREATE OR REPLACE FUNCTION private.offset_stock_count_legacy_quantity(p_receipt_id bigint,p_batch_id uuid)
RETURNS numeric LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  r public.inventory_ledger%ROWTYPE;
  b public.raw_material_batches%ROWTYPE;
  d record;
  remaining numeric;
  take_qty numeric;
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
  FOR d IN
    SELECT f.id,f.oversold_batch_id,f.debt_quantity-f.settled_quantity AS outstanding
    FROM public.raw_fifo_debts f
    WHERE f.raw_material_id=r.raw_material_id AND f.branch_id=r.branch_id
      AND f.warehouse_id=r.warehouse_id AND f.source_created_at<=r.created_at
      AND f.settled_quantity<f.debt_quantity
    ORDER BY f.source_created_at,f.id FOR UPDATE
  LOOP
    EXIT WHEN remaining<=0;
    take_qty:=least(remaining,d.outstanding);
    INSERT INTO public.raw_fifo_settlements(debt_id,receipt_ledger_id,receipt_batch_id,quantity,unit_cost,total_cost)
    VALUES(d.id,r.id,b.id,take_qty,0,0)
    ON CONFLICT(debt_id,receipt_ledger_id) DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.raw_material_batches n SET quantity=n.quantity+take_qty
      WHERE n.id=d.oversold_batch_id AND n.raw_material_id=r.raw_material_id
        AND n.branch_id=r.branch_id AND n.warehouse_id=r.warehouse_id
        AND n.quantity<=-take_qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUNT_NEGATIVE_BATCH_UNRECONCILED'; END IF;
    UPDATE public.raw_fifo_debts SET settled_quantity=settled_quantity+take_qty,updated_at=clock_timestamp()
      WHERE id=d.id;
    remaining:=remaining-take_qty;
    absorbed:=absorbed+take_qty;
  END LOOP;
  UPDATE public.raw_material_batches SET quantity=quantity-absorbed WHERE id=b.id AND absorbed>0;
  RETURN absorbed;
END;
$$;
REVOKE ALL ON FUNCTION private.offset_stock_count_legacy_quantity(bigint,uuid) FROM PUBLIC,anon,authenticated;
