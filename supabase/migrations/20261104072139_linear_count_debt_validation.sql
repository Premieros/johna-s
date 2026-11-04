BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $baseline$ BEGIN
 IF md5(pg_get_functiondef('private.validate_count_legacy_quantity(uuid,uuid,uuid)'::regprocedure))<>'a9d0d8bae0b515b653b64ccae179c5e4' THEN RAISE EXCEPTION 'COUNT_LINEAR_VALIDATION_BASELINE_CHANGED'; END IF;
 IF md5(pg_get_functiondef('private.apply_raw_stock_count_last_price(uuid)'::regprocedure))<>'b2a29ea7e728da9dad45c86afce9444c' THEN RAISE EXCEPTION 'COUNT_LINEAR_VALIDATION_BASELINE_CHANGED'; END IF;
 IF md5(pg_get_functiondef('private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb)'::regprocedure))<>'405ba077acce0ebf9dc6f5e7f904d39d' THEN RAISE EXCEPTION 'COUNT_LINEAR_VALIDATION_BASELINE_CHANGED'; END IF;
 IF md5(pg_get_functiondef('private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb)'::regprocedure))<>'36c80bf7689203658f932af477d7d1ab' THEN RAISE EXCEPTION 'COUNT_LINEAR_VALIDATION_BASELINE_CHANGED'; END IF;
 IF md5(pg_get_functiondef('public._raw_fifo_settle_receipt(bigint,uuid,uuid)'::regprocedure))<>'1bb3459880df6313cf50f50d0ca0143b' THEN RAISE EXCEPTION 'COUNT_RECEIPT_FREEZE_BASELINE_CHANGED'; END IF;
END $baseline$;
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
-- Remove the previous internal overloads to keep default-argument calls unambiguous.
DROP FUNCTION IF EXISTS private.raw_issue_approved_v2(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS private.raw_receive_approved_v2(uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz);
-- UNWIRED disposable-Postgres prototype, NEVER a production migration.
-- Requires scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql
-- See docs/RAW_COST_ENGINE_V2_APPROVED_PRICE_20261031.md.
-- All functions remain in private schema and have no new public invoker.
-- Internal wrappers in production MUST authenticate/authorize the full
-- branch/warehouse movement before ever calling these helpers.
CREATE OR REPLACE FUNCTION private.raw_issue_approved_v2(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_entry_type text,p_reference_type text,p_reference_id uuid,
  p_reference_number text DEFAULT NULL,p_created_by uuid DEFAULT NULL,
  p_valuation_as_of timestamptz DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL,
  p_frozen_price jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_price record;
  v_batch record;
  v_qty numeric(18,6);
  v_take numeric(18,6);
  v_before numeric(18,6);
  v_running numeric(18,6);
  v_batch_no text;
  v_shortage_basis numeric(20,6);
  v_branch_qty numeric(18,6);
  v_branch_value numeric(20,6);
  v_ledger_id bigint;
  v_count_deficit_batch uuid;
  v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL
     OR p_raw_material_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_INPUT');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w
    WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.raw_materials m
    WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_WAREHOUSE_BRANCH_MISMATCH');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=p_raw_material_id
      AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
      AND d.settled_quantity<d.debt_quantity)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
    WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
      AND b.branch_id=p_branch_id AND b.quantity<0
      AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  END IF;
  IF p_frozen_price IS NOT NULL THEN
    IF p_reference_type IS DISTINCT FROM 'stock_count'
      OR (p_frozen_price->>'raw_material_id')::uuid IS DISTINCT FROM p_raw_material_id
      OR (p_frozen_price->>'branch_id')::uuid IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_PRICE_CONTEXT_MISMATCH';
    END IF;
    SELECT (p_frozen_price->>'unit_cost')::numeric unit_cost,
      p_frozen_price->>'price_source' price_source,
      (p_frozen_price->>'priced_at')::timestamptz priced_at,
      p_frozen_price->>'reference_number' reference_number INTO v_price;
  ELSE
  SELECT * INTO v_price FROM private.latest_approved_raw_prices(
    p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
  WHERE raw_material_id=p_raw_material_id;
  IF p_reference_type='stock_count' AND v_price.unit_cost IS NULL THEN
    SELECT * INTO v_price FROM private.stock_count_raw_price(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
  END IF;
  END IF;
  IF v_price.unit_cost IS NULL OR v_price.unit_cost<0
    OR v_price.priced_at IS NULL
    OR v_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero') THEN
    RETURN jsonb_build_object('success',false,'error','APPROVED_RAW_PRICE_UNAVAILABLE');
  END IF;
  SELECT COALESCE(SUM(quantity),0) INTO v_before
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id;
  v_running:=v_before;
  v_qty:=p_qty;

  FOR v_batch IN
    SELECT b.id,b.batch_number,b.quantity,b.expiry_date
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=p_raw_material_id AND b.branch_id=p_branch_id
      AND b.warehouse_id=p_warehouse_id AND b.quantity>0
    ORDER BY b.expiry_date NULLS LAST,b.created_at,b.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_qty<=0;
    v_take:=LEAST(v_qty,v_batch.quantity);
    UPDATE public.raw_material_batches SET quantity=quantity-v_take WHERE id=v_batch.id;
    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,-v_take,
      v_price.unit_cost,-v_take*v_price.unit_cost,v_running,v_running-v_take,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    );
    v_running:=v_running-v_take;
    v_qty:=v_qty-v_take;
  END LOOP;

  IF v_qty>0 THEN
    IF p_reference_type='stock_count' THEN
      INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,source_id)
      VALUES(p_raw_material_id,p_branch_id,p_warehouse_id,'SC-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
        -v_qty,v_price.unit_cost,'stock_count_oversold',p_reference_id)
      RETURNING id,batch_number INTO v_count_deficit_batch,v_batch_no;
    ELSE
    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,
      source_type,source_id,approved_shortage_total_cost
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,
      'AS-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
      -v_qty,v_price.unit_cost,NULL,NULL,'approved_shortage_aggregate',NULL,
      v_qty*v_price.unit_cost
    )
    ON CONFLICT(branch_id,warehouse_id,raw_material_id)
      WHERE source_type='approved_shortage_aggregate'
    DO UPDATE SET
      quantity=public.raw_material_batches.quantity+EXCLUDED.quantity,
      approved_shortage_total_cost=
        public.raw_material_batches.approved_shortage_total_cost
        +EXCLUDED.approved_shortage_total_cost,
      unit_cost=(public.raw_material_batches.approved_shortage_total_cost
        +EXCLUDED.approved_shortage_total_cost)
        / abs(public.raw_material_batches.quantity+EXCLUDED.quantity)
    RETURNING batch_number INTO v_batch_no;

    END IF;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,created_at,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,-v_qty,
      v_price.unit_cost,-v_qty*v_price.unit_cost,v_running,v_running-v_qty,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
    IF v_count_deficit_batch IS NOT NULL THEN
      INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,
        reference_type,reference_id,reference_number,debt_quantity,source_created_at)
      VALUES(v_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,v_count_deficit_batch,
        p_reference_type,p_reference_id,p_reference_number,v_qty,COALESCE(p_effective_at,v_now));
    END IF;
  END IF;

  SELECT COALESCE(sum(quantity),0),
    COALESCE(sum(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
  VALUES(p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET
    quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();
  RETURN jsonb_build_object(
    'success',true,'removed',p_qty,'oversold',v_qty,
    'total_cost',p_qty*v_price.unit_cost,'avg_cost',v_price.unit_cost,
    'approved_price_source',v_price.price_source,'approved_price_at',v_price.priced_at,
    'approved_price_ref',v_price.reference_number,
    'warehouse_id',p_warehouse_id,'shortage_ledger_id',v_ledger_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION private.raw_receive_approved_v2(
  p_raw_material_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_qty numeric,
  p_receipt_unit_cost numeric,p_entry_type text,p_reference_type text,p_reference_id uuid,
  p_reference_number text DEFAULT NULL,p_created_by uuid DEFAULT NULL,
  p_valuation_as_of timestamptz DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL,
  p_frozen_price jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_shortage public.raw_material_batches%ROWTYPE;
  v_approved_price record;
  v_approved_price_source text;
  v_approved_priced_at timestamptz;
  v_approved_price_ref text;
  v_shortage_absorbed numeric(18,6):=0;
  v_shortage_basis numeric(20,6):=0;
  v_variance numeric(20,6):=0;
  v_posted_variance numeric(18,2);
  v_available_after numeric(18,6);
  v_before numeric(18,6);
  v_branch_qty numeric(18,6);
  v_branch_value numeric(20,6);
  v_now timestamptz:=statement_timestamp();
  v_batch_no text;
  v_receipt_ledger bigint;
  v_receipt_batch uuid;
  v_journal uuid;
  v_journal_number text;
  v_variance_account uuid;
  v_inventory_account uuid;
  v_variance_reference uuid;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_receipt_unit_cost IS NULL
     OR p_receipt_unit_cost<0 OR p_warehouse_id IS NULL
     OR p_raw_material_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_INVALID_INPUT');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w
      WHERE w.id=p_warehouse_id AND w.branch_id=p_branch_id AND w.is_active)
    OR NOT EXISTS(SELECT 1 FROM public.raw_materials m
      WHERE m.id=p_raw_material_id AND m.branch_id=p_branch_id AND m.is_active) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_WAREHOUSE_BRANCH_MISMATCH');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0));
  IF p_reference_type='stock_count' THEN
    IF coalesce((p_frozen_price->>'quantity_verified')::boolean,false) IS NOT TRUE THEN
      PERFORM private.validate_count_legacy_quantity(p_raw_material_id,p_branch_id,p_warehouse_id);
    END IF;
  ELSE
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d WHERE d.raw_material_id=p_raw_material_id
    AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
    AND d.settled_quantity<d.debt_quantity)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
      WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
        AND b.branch_id=p_branch_id AND b.quantity<0
        AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  END IF;
  -- Stock-count receipts must use the very same historically approved price
  -- as the posting RPC and persist the source on the physical ledger.
  IF p_reference_type='stock_count' THEN
    IF p_frozen_price IS NOT NULL THEN
    IF p_reference_type IS DISTINCT FROM 'stock_count'
      OR (p_frozen_price->>'raw_material_id')::uuid IS DISTINCT FROM p_raw_material_id
      OR (p_frozen_price->>'branch_id')::uuid IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'STOCK_COUNT_PRICE_CONTEXT_MISMATCH';
    END IF;
    SELECT (p_frozen_price->>'unit_cost')::numeric unit_cost,
      p_frozen_price->>'price_source' price_source,
      (p_frozen_price->>'priced_at')::timestamptz priced_at,
      p_frozen_price->>'reference_number' reference_number INTO v_approved_price;
    ELSE
    SELECT * INTO v_approved_price FROM private.stock_count_raw_price(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
    END IF;
    IF v_approved_price.unit_cost IS NULL OR v_approved_price.unit_cost<0
       OR v_approved_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero')
       OR v_approved_price.unit_cost IS DISTINCT FROM p_receipt_unit_cost THEN
      RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_PRICE_MISMATCH');
    END IF;
    v_approved_price_source:=v_approved_price.price_source;
    v_approved_priced_at:=v_approved_price.priced_at;
    v_approved_price_ref:=v_approved_price.reference_number;
  END IF;
  SELECT COALESCE(sum(quantity),0) INTO v_before FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id;

  SELECT * INTO v_shortage FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id AND source_type='approved_shortage_aggregate'
    FOR UPDATE;
  IF v_shortage.id IS NOT NULL AND v_shortage.quantity<0 THEN
    v_shortage_absorbed:=LEAST(p_qty,abs(v_shortage.quantity));
    v_shortage_basis:=v_shortage_absorbed
      *(v_shortage.approved_shortage_total_cost/abs(v_shortage.quantity));
    v_variance:=v_shortage_absorbed*p_receipt_unit_cost-v_shortage_basis;
    UPDATE public.raw_material_batches SET
      quantity=v_shortage.quantity+v_shortage_absorbed,
      approved_shortage_total_cost=GREATEST(
        v_shortage.approved_shortage_total_cost-v_shortage_basis,0),
      unit_cost=CASE WHEN v_shortage.quantity+v_shortage_absorbed<0
        THEN GREATEST(v_shortage.approved_shortage_total_cost-v_shortage_basis,0)
            /abs(v_shortage.quantity+v_shortage_absorbed)
        ELSE 0 END
    WHERE id=v_shortage.id;
  END IF;
  v_available_after:=p_qty-v_shortage_absorbed;
  v_batch_no:='AR-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  INSERT INTO public.raw_material_batches(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    source_type,source_id
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    v_available_after,p_receipt_unit_cost,COALESCE(p_reference_type,p_entry_type),p_reference_id
  ) RETURNING id INTO v_receipt_batch;
  INSERT INTO public.inventory_ledger(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,
    reference_number,created_by,created_at,
    approved_cost_basis,approved_price_source,approved_price_at,
    approved_price_ref,approved_cost_recorded_at
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,
    p_receipt_unit_cost,p_qty*p_receipt_unit_cost,v_before,v_before+p_qty,
    p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      COALESCE(p_effective_at,v_now),
    CASE WHEN p_reference_type='stock_count' THEN 'approved_last_known' ELSE NULL END,
    v_approved_price_source,v_approved_priced_at,
    v_approved_price_ref,
    CASE WHEN p_reference_type='stock_count' THEN v_now ELSE NULL END
  ) RETURNING id INTO v_receipt_ledger;

  IF p_reference_type='stock_count' AND coalesce((p_frozen_price->>'defer_quantity_offset')::boolean,false) IS NOT TRUE THEN
    PERFORM private.offset_stock_count_legacy_quantity(v_receipt_ledger,v_receipt_batch);
  END IF;
  v_posted_variance:=round(v_variance,2);
  IF abs(v_posted_variance)>=0.01 THEN
    SELECT account_id INTO v_variance_account FROM public.account_mappings
      WHERE branch_id=p_branch_id AND semantic_key='stock_variance';
    SELECT account_id INTO v_inventory_account FROM public.account_mappings
      WHERE branch_id=p_branch_id AND semantic_key='inventory_rm';
    IF v_variance_account IS NULL OR v_inventory_account IS NULL
      OR v_variance_account=v_inventory_account THEN
      RAISE EXCEPTION 'APPROVED_COST_ACCOUNT_MAPPING_MISSING branch=%',p_branch_id;
    END IF;
    v_variance_reference:=md5('approved-raw-shortage-receipt:'||v_receipt_ledger::text)::uuid;
    v_journal_number:=(public.next_document_number('journal')->>'number');
    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_journal_number,p_branch_id,(v_now AT TIME ZONE 'Africa/Cairo')::date,
      'approved_raw_shortage_variance',v_variance_reference,p_reference_number,
      'Frozen approved raw issue / actual receipt shortage variance '||v_receipt_ledger,
      p_created_by
    ) RETURNING id INTO v_journal;
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES(
      v_journal,v_variance_account,
      GREATEST(v_posted_variance,0),GREATEST(-v_posted_variance,0),
      'Approved shortage vs receipt cost'
    ),(
      v_journal,v_inventory_account,
      GREATEST(-v_posted_variance,0),GREATEST(v_posted_variance,0),
      'Raw warehouse inventory shortage offset'
    );
  END IF;

  SELECT COALESCE(sum(quantity),0),
    COALESCE(sum(quantity*COALESCE(unit_cost,0)),0)
    INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches WHERE raw_material_id=p_raw_material_id AND branch_id=p_branch_id;
  INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost)
  VALUES(p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END)
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET
    quantity=EXCLUDED.quantity,avg_cost=EXCLUDED.avg_cost,updated_at=now();

  RETURN jsonb_build_object(
    'success',true,'warehouse_id',p_warehouse_id,
    'before_qty',v_before,'after_qty',v_before+p_qty,
    'approved_shortage_absorbed',v_shortage_absorbed,
    'approved_price_variance_exact',v_variance,
    'approved_price_variance_posted',v_posted_variance,
    'receipt_ledger_id',v_receipt_ledger,'journal_entry_id',v_journal
  );
END;
$fn$;

-- Deliberately NO SECURITY DEFINER, no public RPC, no API execute grant.
REVOKE ALL ON FUNCTION private.raw_issue_approved_v2(
 uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb
) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.raw_receive_approved_v2(
 uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz,timestamptz,jsonb
) FROM PUBLIC,anon,authenticated,service_role;
-- DO NOT DEPLOY: depends on UNINSTALLED private approved-v2 physical helpers.
-- Uses the existing central approved-price source, never FIFO for raw counts.
-- Missing price and legacy debt coordinates fail closed; no rollout is authorized.
-- Requires independent disposable-DB and accounting reconciliation tests.
CREATE OR REPLACE FUNCTION private.apply_raw_stock_count_last_price(p_stock_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count public.stock_counts%ROWTYPE;
  v_item public.stock_count_items%ROWTYPE;
  v_current numeric(14,4);
  v_lock_raw uuid;
  v_prices jsonb;
  v_positions jsonb;
  v_price_data jsonb;
  v_valuation_at timestamptz:=statement_timestamp();
  v_later_delta numeric;
  v_ledger_at_creation numeric;
  v_expected_current numeric;
  v_final_price numeric(18,6);
  v_price_source text;
  v_variance numeric(14,4);
  v_applied integer := 0;
  v_res jsonb;
  v_shortage numeric(14,4);
  v_value numeric(14,2);
  v_fg_delta numeric(14,2) := 0;
  v_rm_delta numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_journal_id uuid;
BEGIN
  BEGIN
    SELECT *
      INTO v_count
      FROM public.stock_counts
      WHERE id = p_stock_count_id
      FOR UPDATE;

    IF v_count.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_FOUND');
    END IF;

    IF v_count.status <> 'approved' THEN
      RETURN jsonb_build_object('success', false, 'error', 'COUNT_NOT_APPROVED', 'status', v_count.status);
    END IF;

    IF NOT public.can_permission('inventory.count.apply') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT public.user_may_access_branch(v_count.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=v_count.warehouse_id AND branch_id=v_count.branch_id AND is_active) THEN
      RAISE EXCEPTION 'WAREHOUSE_BRANCH_MISMATCH';
    END IF;
    IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=v_count.id
      AND (counted_quantity IS NULL OR counted_quantity<0 OR (raw_material_id IS NULL AND product_id IS NULL)
        OR (raw_material_id IS NOT NULL AND product_id IS NOT NULL)))
      OR EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=v_count.id AND raw_material_id IS NOT NULL
        GROUP BY raw_material_id HAVING count(*)>1) THEN
      RAISE EXCEPTION 'STOCK_COUNT_INVALID_LINES';
    END IF;

    IF EXISTS(SELECT 1 FROM public.stock_count_items WHERE stock_count_id=v_count.id AND product_id IS NOT NULL) THEN
      RAISE EXCEPTION 'RAW_ONLY_STOCK_COUNT_REQUIRED';
    END IF;
    IF EXISTS(SELECT 1 FROM public.inventory_ledger WHERE reference_type='stock_count' AND reference_id=v_count.id)
      OR EXISTS(SELECT 1 FROM public.journal_entries WHERE reference_type='stock_count' AND reference_id=v_count.id) THEN
      RAISE EXCEPTION 'COUNT_EXISTING_POSTING_REQUIRES_REVIEW';
    END IF;

    -- A later applied count supersedes this count on overlapping coordinates.
    IF EXISTS (
      SELECT 1 FROM public.stock_count_items original
      JOIN public.stock_counts later ON later.branch_id=v_count.branch_id
        AND later.warehouse_id=v_count.warehouse_id AND later.status='applied'
        AND later.created_at>v_count.created_at
      JOIN public.stock_count_items line ON line.stock_count_id=later.id
        AND (line.raw_material_id=original.raw_material_id OR line.product_id=original.product_id)
      WHERE original.stock_count_id=v_count.id
    ) THEN
      RETURN jsonb_build_object('success',false,'error','LATER_STOCK_COUNT_ALREADY_APPLIED');
    END IF;

    -- Use the same locks as live raw sales/receipts, in stable order. A busy
    -- coordinate returns promptly rather than making the till wait for a count.
    FOR v_lock_raw IN SELECT DISTINCT raw_material_id FROM public.stock_count_items
      WHERE stock_count_id=p_stock_count_id AND raw_material_id IS NOT NULL ORDER BY raw_material_id
    LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended(v_lock_raw::text||':'||v_count.branch_id::text,0)) THEN
        RAISE EXCEPTION 'STOCK_COUNT_STOCK_BUSY_RETRY';
      END IF;
    END LOOP;

    -- Count lines and all stock coordinates are locked before taking the
    -- shared snapshots. No per-item full movement-history/price query follows.
    PERFORM 1 FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id ORDER BY id FOR UPDATE;
    -- Validate every negative lot once, not once per lot or per receipt.
    IF EXISTS (
      WITH materials AS MATERIALIZED (SELECT raw_material_id FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id),
      debt AS MATERIALIZED (
        SELECT d.raw_material_id,d.oversold_batch_id,sum(d.debt_quantity-d.settled_quantity) qty
        FROM public.raw_fifo_debts d JOIN materials m USING(raw_material_id)
        WHERE d.branch_id=v_count.branch_id AND d.warehouse_id=v_count.warehouse_id AND d.settled_quantity<d.debt_quantity
        GROUP BY d.raw_material_id,d.oversold_batch_id
      ), negative AS MATERIALIZED (
        SELECT b.raw_material_id,b.id,b.quantity FROM public.raw_material_batches b JOIN materials m USING(raw_material_id)
        WHERE b.branch_id=v_count.branch_id AND b.warehouse_id=v_count.warehouse_id AND b.quantity<0
      ) SELECT 1 FROM negative b FULL JOIN debt d ON d.raw_material_id=b.raw_material_id AND d.oversold_batch_id=b.id
        WHERE b.id IS NULL OR d.oversold_batch_id IS NULL OR -b.quantity IS DISTINCT FROM d.qty
    ) THEN RAISE EXCEPTION 'COUNT_LEGACY_QUANTITY_UNRECONCILED'; END IF;
    SELECT jsonb_object_agg(p.raw_material_id::text,to_jsonb(p)||jsonb_build_object('quantity_verified',true,'defer_quantity_offset',true)) INTO v_prices
      FROM private.stock_count_raw_price(v_count.branch_id,
        ARRAY(SELECT raw_material_id FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id),v_valuation_at) p;
    WITH materials AS MATERIALIZED (
      SELECT raw_material_id FROM public.stock_count_items WHERE stock_count_id=p_stock_count_id
    ), history AS (
      SELECT l.raw_material_id,
        coalesce(sum(l.quantity) FILTER(WHERE l.created_at<=v_count.created_at),0) historic,
        coalesce(sum(l.quantity) FILTER(WHERE l.created_at>v_count.created_at),0) later
      FROM public.inventory_ledger l JOIN materials m ON m.raw_material_id=l.raw_material_id
      WHERE l.branch_id=v_count.branch_id AND l.warehouse_id=v_count.warehouse_id GROUP BY l.raw_material_id
    ), physical AS (
      SELECT b.raw_material_id,sum(b.quantity) qty FROM public.raw_material_batches b
      JOIN materials m ON m.raw_material_id=b.raw_material_id
      WHERE b.branch_id=v_count.branch_id AND b.warehouse_id=v_count.warehouse_id GROUP BY b.raw_material_id
    ) SELECT jsonb_object_agg(m.raw_material_id::text,jsonb_build_object(
      'current',coalesce(p.qty,0),'historic',coalesce(h.historic,0),'later',coalesce(h.later,0)))
      INTO v_positions FROM materials m LEFT JOIN history h USING(raw_material_id) LEFT JOIN physical p USING(raw_material_id);

    FOR v_item IN
      SELECT *
      FROM public.stock_count_items
      WHERE stock_count_id = p_stock_count_id
      ORDER BY id
      FOR UPDATE
    LOOP
      v_value := 0;

      IF v_item.raw_material_id IS NOT NULL THEN
        -- Take the same canonical material/branch lock as approved-v2 issue
        -- and receipt BEFORE reading warehouse stock. Without it a sale or
        -- transfer can move quantity between the count snapshot and posting.
        PERFORM pg_advisory_xact_lock(hashtextextended(
          v_item.raw_material_id::text||':'||v_count.branch_id::text,0
        ));
        -- Price uses the latest published source at posting; the quantity cutoff
        -- remains the count creation time. These timestamps are independent.
        v_price_data:=v_prices->v_item.raw_material_id::text;
        v_final_price:=(v_price_data->>'unit_cost')::numeric;
        v_price_source:=v_price_data->>'price_source';
        -- Explicitly recorded zero is a valid cost. Missing (NULL / unpriced)
        -- and negative prices are invalid. The source projection must be updated
        -- separately to preserve legitimate zero-priced source events.
        -- Applied historical stock counts are filtered by its visibility predicate.
        IF v_final_price IS NULL OR v_final_price < 0
           OR v_price_source IS NULL
           OR v_price_source NOT IN ('purchase','pricing','stock_count','catalog_zero') THEN
          RAISE EXCEPTION 'APPROVED_RAW_PRICE_UNAVAILABLE material % branch % as_of %',
            v_item.raw_material_id,v_count.branch_id,v_count.created_at;
        END IF;
        -- Freeze the approved price actually used at posting on the count line.
        -- The existing stock-count source trigger is NOT authoritative until
        -- the parent count becomes applied; this preserves source lineage.
        IF v_item.unit_cost IS DISTINCT FROM v_final_price THEN
          UPDATE public.stock_count_items
             SET unit_cost = v_final_price
           WHERE id = v_item.id AND stock_count_id = v_count.id;
        END IF;
        v_current:=(v_positions->v_item.raw_material_id::text->>'current')::numeric;
        v_later_delta:=(v_positions->v_item.raw_material_id::text->>'later')::numeric;
        v_ledger_at_creation:=(v_positions->v_item.raw_material_id::text->>'historic')::numeric;
        IF v_current-v_later_delta IS DISTINCT FROM v_ledger_at_creation THEN
          RAISE EXCEPTION 'STOCK_COUNT_HISTORICAL_BASELINE_UNVERIFIED item %',v_item.id;
        END IF;
        -- Persist the verified historical baseline so the document shows the
        -- same variance as its stock ledger and accounting entry.
        UPDATE public.stock_count_items SET system_quantity=v_ledger_at_creation
          WHERE id=v_item.id AND system_quantity IS DISTINCT FROM v_ledger_at_creation;
        v_variance := v_item.counted_quantity - (v_current - v_later_delta);
        v_expected_current := v_current + v_variance;

        IF v_variance > 0 THEN
          -- Candidate-only approved-price physical receipt; no legacy FIFO writer.
          v_res := private.raw_receive_approved_v2(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            v_variance, v_final_price,
            'adjustment', 'stock_count', v_count.id, v_count.count_number, auth.uid(), v_valuation_at, v_count.created_at, v_price_data
          );
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'RAW_ADJUST_FAILED';
          END IF;
          v_value := round(v_variance * v_final_price, 2);
          -- A successful helper response is insufficient: a partial receipt or
          -- receipt-side legacy debt absorption may silently break journal parity.
          IF COALESCE((v_res->>'after_qty')::numeric,0)
               - COALESCE((v_res->>'before_qty')::numeric,0) IS DISTINCT FROM v_variance
             OR NOT EXISTS (
               SELECT 1 FROM public.inventory_ledger il
               WHERE il.id=(v_res->>'receipt_ledger_id')::bigint
                 AND il.reference_id=v_count.id AND il.reference_type='stock_count'
                 AND il.raw_material_id=v_item.raw_material_id
                 AND il.warehouse_id=v_count.warehouse_id
                 AND il.quantity=v_variance
                 AND round(il.total_cost,2)=v_value
             ) THEN
            RAISE EXCEPTION 'STOCK_COUNT_APPROVED_RECEIPT_MISMATCH raw %',v_item.raw_material_id;
          END IF;
          v_rm_delta := v_rm_delta + v_value;
        ELSIF v_variance < 0 THEN
          v_res := private.raw_issue_approved_v2(
            v_item.raw_material_id, v_count.branch_id, v_count.warehouse_id,
            -v_variance, 'adjustment', 'stock_count', v_count.id,
            v_count.count_number, auth.uid(), v_valuation_at, v_count.created_at, v_price_data
          );
          IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
            RAISE EXCEPTION 'STOCK_COUNT_REMOVE_FAILED: %',COALESCE(v_res->>'error','unknown');
          END IF;
          v_shortage := COALESCE((v_res->>'shortage')::numeric, 0);
          IF v_shortage > 0 THEN
            RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED: %', 'STOCK_COUNT_SHORTAGE';
          END IF;
          -- Approved-price v2 movement emits the physical ledger at the same
          -- canonical approved price as the balancing accounting journal.
          -- No FIFO valuation, zero-quantity revaluation bridge or debt replay.
          v_value := round(-v_variance * v_final_price, 2);
          IF COALESCE((v_res->>'removed')::numeric,0) IS DISTINCT FROM -v_variance
             OR round(COALESCE((v_res->>'total_cost')::numeric,0),2) IS DISTINCT FROM v_value THEN
            RAISE EXCEPTION 'STOCK_COUNT_APPROVED_MOVEMENT_MISMATCH raw %',v_item.raw_material_id;
          END IF;
          v_rm_delta := v_rm_delta - v_value;
        END IF;
        -- Both receipt and issue paths must leave the specific warehouse at
        -- the physically counted quantity. Never infer this only from a
        -- helper success flag or posted journal/ledger amounts.
        SELECT COALESCE(quantity,0) INTO v_current
          FROM public.raw_material_warehouse_inventory
         WHERE raw_material_id=v_item.raw_material_id
           AND branch_id=v_count.branch_id
           AND warehouse_id=v_count.warehouse_id;
        IF COALESCE(v_current,0) IS DISTINCT FROM v_expected_current THEN
          RAISE EXCEPTION 'STOCK_COUNT_WAREHOUSE_QUANTITY_MISMATCH material % expected % actual %',
            v_item.raw_material_id,v_expected_current,COALESCE(v_current,0);
        END IF;
      END IF;

      v_applied := v_applied + 1;
    END LOOP;

    IF v_fg_delta > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_fg', 'debit', round(v_fg_delta, 2), 'credit', 0,
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', 0, 'credit', round(v_fg_delta, 2),
        'note', v_count.count_number || ' · finished goods'
      );
    ELSIF v_fg_delta < 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_fg', 'debit', 0, 'credit', round(-v_fg_delta, 2),
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', round(-v_fg_delta, 2), 'credit', 0,
        'note', v_count.count_number || ' · finished goods'
      );
    END IF;

    IF v_rm_delta > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_rm', 'debit', round(v_rm_delta, 2), 'credit', 0,
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', 0, 'credit', round(v_rm_delta, 2),
        'note', v_count.count_number || ' · raw materials'
      );
    ELSIF v_rm_delta < 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'inventory_rm', 'debit', 0, 'credit', round(-v_rm_delta, 2),
        'note', v_count.count_number
      );
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'stock_variance', 'debit', round(-v_rm_delta, 2), 'credit', 0,
        'note', v_count.count_number || ' · raw materials'
      );
    END IF;

    IF jsonb_array_length(v_lines) > 0 THEN
      v_journal_id := public._post_journal_entry(
        v_count.branch_id,
        'stock_count',
        v_count.id,
        v_count.count_number,
        'تسوية جرد ' || COALESCE(v_count.count_number, v_count.id::text),
        v_lines
      );
    END IF;

    UPDATE public.stock_counts
    SET status = 'applied', applied_at = now()
    WHERE id = p_stock_count_id;

    RETURN jsonb_build_object(
      'success', true,
      'items_applied', v_applied,
      'journal_entry_id', v_journal_id
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TRANSACTION_FAILED',
        'detail', SQLERRM
      );
  END;
END;
$function$;
REVOKE ALL ON FUNCTION private.apply_raw_stock_count_last_price(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(p_receipt_ledger_id bigint, p_receipt_batch_id uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_receipt public.inventory_ledger%ROWTYPE;
  v_batch public.raw_material_batches%ROWTYPE;
  v_debt record;
  v_source public.inventory_ledger%ROWTYPE;
  v_estimate public.raw_fifo_debt_price_estimates%ROWTYPE;
  v_take numeric(18,6);
  v_available numeric(18,6);
  v_actual_value numeric(18,6);
  v_estimate_take numeric(18,6);
  v_estimate_value numeric(18,6);
  v_delta numeric(18,6);
  v_new_total numeric(18,6);
  v_settlement_id uuid;
  v_res jsonb;
  v_had_estimate boolean;
  v_total_settled numeric(18,6):=0;
  v_count_cutoff timestamptz;
  v_total_value numeric(18,6):=0;
  v_total_adjustment numeric(18,6):=0;
BEGIN
  SELECT * INTO v_receipt
  FROM public.inventory_ledger
  WHERE id=p_receipt_ledger_id
    AND raw_material_id IS NOT NULL
    AND quantity>0
  FOR SHARE;

  SELECT * INTO v_batch
  FROM public.raw_material_batches
  WHERE id=p_receipt_batch_id
  FOR UPDATE;

  IF v_receipt.id IS NULL OR v_batch.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_NOT_FOUND');
  END IF;

  IF v_batch.raw_material_id<>v_receipt.raw_material_id
     OR v_batch.branch_id<>v_receipt.branch_id
     OR v_batch.warehouse_id IS DISTINCT FROM v_receipt.warehouse_id THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_RECEIPT_BATCH_MISMATCH');
  END IF;

  v_available:=LEAST(v_receipt.quantity,GREATEST(v_batch.quantity,0));

  -- An applied physical count freezes the cost of the consumption it covers,
  -- even while quantity-only legacy cleanup is being drained in small batches.
  SELECT max(c.created_at) INTO v_count_cutoff
  FROM public.stock_count_items i JOIN public.stock_counts c ON c.id=i.stock_count_id
  WHERE i.raw_material_id=v_receipt.raw_material_id AND c.branch_id=v_receipt.branch_id
    AND c.warehouse_id=v_receipt.warehouse_id AND c.status='applied' AND c.created_at<=v_receipt.created_at;


  FOR v_debt IN
    SELECT d.*
    FROM public.raw_fifo_debts d
    WHERE d.raw_material_id=v_receipt.raw_material_id
      AND d.branch_id=v_receipt.branch_id
      AND d.warehouse_id=v_receipt.warehouse_id
      AND d.source_created_at<=v_receipt.created_at
      AND d.settled_quantity<d.debt_quantity
    ORDER BY d.source_created_at,d.source_ledger_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_available<=0;

    v_take:=LEAST(v_available,v_debt.debt_quantity-v_debt.settled_quantity);
    IF v_take<=0 THEN CONTINUE; END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    ) VALUES (
      v_debt.id,v_receipt.id,v_batch.id,v_take,
      COALESCE(v_receipt.unit_cost,0),
      v_take*COALESCE(v_receipt.unit_cost,0),
      p_run_id
    )
    ON CONFLICT (debt_id,receipt_ledger_id) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_debt.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL OR v_source.quantity>=0 THEN
      UPDATE public.raw_fifo_settlements
      SET reconciliation_status='error',
          reconciliation_error='FIFO_SOURCE_LEDGER_INVALID'
      WHERE id=v_settlement_id;
      CONTINUE;
    END IF;

    IF v_source.approved_cost_basis='approved_last_known'
       OR (v_count_cutoff IS NOT NULL AND v_source.created_at<=v_count_cutoff) THEN
      -- New approved-price movements keep their original valuation forever.
      v_actual_value:=0; v_delta:=0; v_new_total:=v_source.total_cost;
      UPDATE public.raw_fifo_settlements SET unit_cost=0,total_cost=0 WHERE id=v_settlement_id;
      UPDATE public.raw_fifo_debt_price_estimates
        SET zero_cost_finalized_quantity=zero_cost_finalized_quantity+least(v_take,remaining_estimated_quantity),
            remaining_estimated_quantity=greatest(remaining_estimated_quantity-v_take,0),updated_at=clock_timestamp()
        WHERE debt_id=v_debt.id AND remaining_estimated_quantity>0;
    ELSE
    v_had_estimate:=false;
    v_estimate_take:=0;
    v_estimate_value:=0;
    v_actual_value:=v_take*COALESCE(v_receipt.unit_cost,0);
    v_delta:=v_actual_value;

    SELECT * INTO v_estimate
    FROM public.raw_fifo_debt_price_estimates
    WHERE debt_id=v_debt.id
    FOR UPDATE;

    IF v_estimate.debt_id IS NOT NULL
       AND v_estimate.remaining_estimated_quantity>0 THEN
      v_had_estimate:=true;
      v_estimate_take:=LEAST(v_take,v_estimate.remaining_estimated_quantity);
      v_estimate_value:=v_estimate_take*v_estimate.estimated_unit_cost;

      IF COALESCE(v_receipt.unit_cost,0)>0 THEN
        -- Actual receipt replaces the provisional basis only by the difference.
        v_delta:=v_actual_value-v_estimate_value;
        UPDATE public.raw_fifo_debt_price_estimates
        SET remaining_estimated_quantity=GREATEST(remaining_estimated_quantity-v_estimate_take,0),
            replaced_quantity=replaced_quantity+v_estimate_take,
            updated_at=now()
        WHERE debt_id=v_debt.id;
      ELSE
        -- A zero-cost receipt is not a stronger valuation source; preserve fallback cost.
        v_delta:=0;
        UPDATE public.raw_fifo_debt_price_estimates
        SET remaining_estimated_quantity=GREATEST(remaining_estimated_quantity-v_estimate_take,0),
            zero_cost_finalized_quantity=zero_cost_finalized_quantity+v_estimate_take,
            updated_at=now()
        WHERE debt_id=v_debt.id;
      END IF;
    END IF;

    v_new_total:=COALESCE(v_source.total_cost,0)-v_delta;
    IF v_new_total>0.005 THEN
      RAISE EXCEPTION
        'FIFO_PRICE_FALLBACK_SETTLEMENT_NEGATIVE_COST ledger=% current=% delta=%',
        v_source.id,v_source.total_cost,v_delta;
    END IF;

    END IF;

    UPDATE public.raw_fifo_debts
    SET settled_quantity=settled_quantity+v_take,
        updated_at=now()
    WHERE id=v_debt.id;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.raw_material_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_take,0)
    WHERE id=v_batch.id;

    IF v_source.approved_cost_basis IS DISTINCT FROM 'approved_last_known'
       AND NOT (v_count_cutoff IS NOT NULL AND v_source.created_at<=v_count_cutoff) THEN
    UPDATE public.inventory_ledger
    SET total_cost=v_new_total,
        unit_cost=CASE
          WHEN quantity<0 THEN abs(v_new_total/quantity)
          ELSE unit_cost
        END
    WHERE id=v_source.id;

    END IF;

    IF abs(v_delta)>0.000001 THEN
      v_res:=public._fifo_adjust_reference_delta(
        v_source.reference_type,
        v_source.reference_id,
        v_source.branch_id,
        v_source.warehouse_id,
        'raw_material',
        v_source.raw_material_id,
        v_delta,
        0
      );

      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        IF v_had_estimate THEN
          RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REFERENCE_RECONCILIATION_FAILED ledger=% detail=%',
            v_source.id,v_res;
        END IF;

        UPDATE public.raw_fifo_settlements
        SET reconciliation_status='error',
            reconciliation_error=COALESCE(v_res->>'error','FIFO_REFERENCE_RECONCILIATION_FAILED')
        WHERE id=v_settlement_id;
      END IF;
    END IF;

    v_available:=v_available-v_take;
    v_total_settled:=v_total_settled+v_take;
    v_total_value:=v_total_value+v_actual_value;
    v_total_adjustment:=v_total_adjustment+v_delta;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'cost_adjustment',v_total_adjustment,
    'remaining_receipt_quantity',v_available
  );
END;
$function$;
COMMIT;
