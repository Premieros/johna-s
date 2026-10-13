-- #497 P4 isolated receipt write reuse. Not a migration; NEVER run on production.
-- Based on read-only live canonical definitions captured 2026-10-13.
-- No index, stock summary replacement, trigger wiring or privileged client entry.
-- Canonical migration replay lacks the live estimate tables: tests disclose that gap.
CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt_reuse_candidate(p_receipt_ledger_id bigint, p_receipt_batch_id uuid, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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
  v_pending_receipt numeric(18,6):=0;
  v_total_settled numeric(18,6):=0;
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

    UPDATE public.raw_fifo_debts
    SET settled_quantity=settled_quantity+v_take,
        updated_at=now()
    WHERE id=v_debt.id;

    IF v_debt.oversold_batch_id IS NOT NULL THEN
      UPDATE public.raw_material_batches
      SET quantity=LEAST(quantity+v_take,0)
      WHERE id=v_debt.oversold_batch_id;
    END IF;

    -- Defer only sale/kitchen sources, whose reconciliation does not mutate stock.
    v_pending_receipt:=v_pending_receipt+v_take;
    IF v_source.reference_type IS NULL
       OR v_source.reference_type NOT IN ('sale','kitchen_send') THEN
      -- Production/transfer/other propagation must see the canonical receipt quantity.
      UPDATE public.raw_material_batches
      SET quantity=GREATEST(quantity-v_pending_receipt,0)
      WHERE id=v_batch.id;
      v_pending_receipt:=0;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=v_new_total,
        unit_cost=CASE
          WHEN quantity<0 THEN abs(v_new_total/quantity)
          ELSE unit_cost
        END
    WHERE id=v_source.id;

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

  -- Flush only successful, not already flushed source quantities.
  IF v_pending_receipt>0 THEN
    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_pending_receipt,0)
    WHERE id=v_batch.id;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'cost_adjustment',v_total_adjustment,
    'remaining_receipt_quantity',v_available
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._raw_fifo_settle_receipt_reuse_candidate(bigint,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._raw_add_receipt_reuse_candidate(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_qty numeric, p_unit_cost numeric DEFAULT 0, p_batch_number text DEFAULT NULL::text, p_production_date date DEFAULT NULL::date, p_expiry_date date DEFAULT NULL::date, p_entry_type text DEFAULT 'purchase'::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_number text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before numeric(14,4):=0;
  v_after numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0;
  v_branch_value numeric(18,4):=0;
  v_branch_avg numeric(12,2):=0;
  v_batch_no text;
  v_batch_id uuid;
  v_ledger_id bigint;
  v_fifo jsonb;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 OR p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PARAMS');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.raw_materials
    WHERE id=p_raw_material_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','RAW_MATERIAL_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_before
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  v_batch_no:=COALESCE(
    NULLIF(btrim(COALESCE(p_batch_number,'')),''),
    'RB-'||substr(replace(gen_random_uuid()::text,'-',''),1,10)
  );

  INSERT INTO public.raw_material_batches(
    raw_material_id,branch_id,warehouse_id,batch_number,
    quantity,unit_cost,production_date,expiry_date,source_type,source_id
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    p_qty,COALESCE(p_unit_cost,0),p_production_date,p_expiry_date,
    COALESCE(p_reference_type,p_entry_type),p_reference_id
  )
  RETURNING id INTO v_batch_id;

  v_after:=v_before+p_qty;

  INSERT INTO public.inventory_ledger(
    raw_material_id,branch_id,warehouse_id,batch_number,
    quantity,unit_cost,total_cost,before_qty,after_qty,
    entry_type,reference_type,reference_id,reference_number,created_by
  ) VALUES (
    p_raw_material_id,p_branch_id,p_warehouse_id,v_batch_no,
    p_qty,COALESCE(p_unit_cost,0),p_qty*COALESCE(p_unit_cost,0),
    v_before,v_after,p_entry_type,p_reference_type,p_reference_id,
    p_reference_number,p_created_by
  )
  RETURNING id INTO v_ledger_id;

  v_fifo:=public._raw_fifo_settle_receipt_reuse_candidate(
    v_ledger_id,
    v_batch_id,
    NULL
  );

  IF COALESCE((v_fifo->>'success')::boolean,false) IS NOT TRUE THEN
    RETURN v_fifo;
  END IF;

  SELECT
    COALESCE(SUM(quantity),0),
    COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;

  v_branch_avg:=CASE
    WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2)
    ELSE 0
  END;

  INSERT INTO public.raw_material_inventory(
    raw_material_id,branch_id,quantity,avg_cost
  ) VALUES (
    p_raw_material_id,p_branch_id,v_branch_qty,v_branch_avg
  )
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      avg_cost=EXCLUDED.avg_cost,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'before_qty',v_before,
    'after_qty',v_after,
    'avg_cost',v_branch_avg,
    'batch_number',v_batch_no,
    'warehouse_id',p_warehouse_id,
    'fifo_settled_quantity',COALESCE((v_fifo->>'settled_quantity')::numeric,0),
    'fifo_settled_value',COALESCE((v_fifo->>'settled_value')::numeric,0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._raw_add_receipt_reuse_candidate(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
