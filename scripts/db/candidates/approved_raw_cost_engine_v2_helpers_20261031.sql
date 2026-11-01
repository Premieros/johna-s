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
  p_valuation_as_of timestamptz DEFAULT NULL
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
  SELECT * INTO v_price FROM private.latest_approved_raw_prices(
    p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
  WHERE raw_material_id=p_raw_material_id;
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
      reference_id,reference_number,created_by,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,-v_take,
      v_price.unit_cost,-v_take*v_price.unit_cost,v_running,v_running-v_take,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    );
    v_running:=v_running-v_take;
    v_qty:=v_qty-v_take;
  END LOOP;

  IF v_qty>0 THEN
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

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,quantity,
      unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,
      reference_id,reference_number,created_by,
      approved_cost_basis,approved_price_source,approved_price_at,
      approved_price_ref,approved_cost_recorded_at
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,-v_qty,
      v_price.unit_cost,-v_qty*v_price.unit_cost,v_running,v_running-v_qty,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
      'approved_last_known',v_price.price_source,v_price.priced_at,
      v_price.reference_number,v_now
    ) RETURNING id INTO v_ledger_id;
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
  p_valuation_as_of timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_shortage public.raw_material_batches%ROWTYPE;
  v_approved_price record;
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
  IF EXISTS(SELECT 1 FROM public.raw_fifo_debts d WHERE d.raw_material_id=p_raw_material_id
    AND d.warehouse_id=p_warehouse_id AND d.branch_id=p_branch_id
    AND d.settled_quantity<d.debt_quantity)
    OR EXISTS(SELECT 1 FROM public.raw_material_batches b
      WHERE b.raw_material_id=p_raw_material_id AND b.warehouse_id=p_warehouse_id
        AND b.branch_id=p_branch_id AND b.quantity<0
        AND b.source_type<>'approved_shortage_aggregate') THEN
    RETURN jsonb_build_object('success',false,'error','LEGACY_FIFO_POSITION_NOT_CUTOVER');
  END IF;
  -- Stock-count receipts must use the very same historically approved price
  -- as the posting RPC and persist the source on the physical ledger.
  IF p_reference_type='stock_count' THEN
    SELECT * INTO v_approved_price FROM private.latest_approved_raw_prices(
      p_branch_id,ARRAY[p_raw_material_id],COALESCE(p_valuation_as_of,v_now))
    WHERE raw_material_id=p_raw_material_id;
    IF v_approved_price.unit_cost IS NULL OR v_approved_price.unit_cost<0
       OR v_approved_price.price_source NOT IN ('purchase','pricing','stock_count','catalog_zero')
       OR v_approved_price.unit_cost IS DISTINCT FROM p_receipt_unit_cost THEN
      RETURN jsonb_build_object('success',false,'error','APPROVED_RECEIPT_PRICE_MISMATCH');
    END IF;
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
  );
  INSERT INTO public.inventory_ledger(
    raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,
    total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,
    reference_number,created_by,
    approved_cost_basis,approved_price_source,approved_price_at,
    approved_price_ref,approved_cost_recorded_at
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,p_qty,
    p_receipt_unit_cost,p_qty*p_receipt_unit_cost,v_before,v_before+p_qty,
    p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by,
    CASE WHEN p_reference_type='stock_count' THEN 'approved_last_known' ELSE NULL END,
    v_approved_price.price_source,v_approved_price.priced_at,
    v_approved_price.reference_number,v_now
  ) RETURNING id INTO v_receipt_ledger;

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
 uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,timestamptz
) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.raw_receive_approved_v2(
 uuid,uuid,uuid,numeric,numeric,text,text,uuid,text,uuid,timestamptz
) FROM PUBLIC,anon,authenticated,service_role;
