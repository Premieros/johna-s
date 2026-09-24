-- Follow-up for zero-cost opening FIFO repair.
-- Adds guarded valuation propagation across approved raw-material warehouse transfers.
-- No repair is auto-executed by this migration.
BEGIN;

CREATE OR REPLACE FUNCTION public._fifo_adjust_warehouse_transfer_delta(
  p_transfer_id uuid,
  p_source_branch_id uuid,
  p_source_warehouse_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_transfer public.warehouse_transfers%ROWTYPE;
  v_item public.warehouse_transfer_items%ROWTYPE;
  v_item_count integer;
  v_dest public.inventory_ledger%ROWTYPE;
  v_dest_count integer;
  v_batch public.raw_material_batches%ROWTYPE;
  v_batch_count integer;
  v_downstream integer;
  v_new_total numeric(18,6);
  v_new_unit numeric(18,6);
BEGIN
  IF p_transfer_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  IF p_target_type<>'raw_material' OR p_target_id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_WAREHOUSE_TRANSFER_TARGET_UNSUPPORTED',
      'target_type',p_target_type,'target_id',p_target_id
    );
  END IF;

  SELECT * INTO v_transfer
  FROM public.warehouse_transfers
  WHERE id=p_transfer_id
  FOR UPDATE;

  IF v_transfer.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_WAREHOUSE_TRANSFER_NOT_FOUND');
  END IF;

  IF v_transfer.status<>'approved'
     OR v_transfer.branch_id IS DISTINCT FROM p_source_branch_id
     OR v_transfer.from_warehouse_id IS DISTINCT FROM p_source_warehouse_id
     OR v_transfer.to_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_WAREHOUSE_TRANSFER_SCOPE_MISMATCH',
      'transfer_id',p_transfer_id
    );
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.warehouse_transfer_items
  WHERE transfer_id=p_transfer_id
    AND raw_material_id=p_target_id;

  IF v_item_count<>1 THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_WAREHOUSE_TRANSFER_ITEM_AMBIGUOUS',
      'transfer_id',p_transfer_id,'matches',v_item_count
    );
  END IF;

  SELECT * INTO v_item
  FROM public.warehouse_transfer_items
  WHERE transfer_id=p_transfer_id
    AND raw_material_id=p_target_id
  LIMIT 1
  FOR UPDATE;

  SELECT count(*) INTO v_dest_count
  FROM public.inventory_ledger il
  WHERE il.reference_type='warehouse_transfer'
    AND il.reference_id=p_transfer_id
    AND il.branch_id=v_transfer.to_branch_id
    AND il.warehouse_id=v_transfer.to_warehouse_id
    AND il.raw_material_id=v_item.destination_raw_material_id
    AND il.quantity>0;

  IF v_dest_count<>1 THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_WAREHOUSE_TRANSFER_DESTINATION_LEDGER_AMBIGUOUS',
      'transfer_id',p_transfer_id,'matches',v_dest_count
    );
  END IF;

  SELECT * INTO v_dest
  FROM public.inventory_ledger il
  WHERE il.reference_type='warehouse_transfer'
    AND il.reference_id=p_transfer_id
    AND il.branch_id=v_transfer.to_branch_id
    AND il.warehouse_id=v_transfer.to_warehouse_id
    AND il.raw_material_id=v_item.destination_raw_material_id
    AND il.quantity>0
  LIMIT 1
  FOR UPDATE;

  SELECT count(*) INTO v_batch_count
  FROM public.raw_material_batches b
  WHERE b.raw_material_id=v_dest.raw_material_id
    AND b.branch_id=v_dest.branch_id
    AND b.warehouse_id=v_dest.warehouse_id
    AND b.batch_number IS NOT DISTINCT FROM v_dest.batch_number;

  IF v_batch_count<>1 THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_WAREHOUSE_TRANSFER_DESTINATION_BATCH_AMBIGUOUS',
      'transfer_id',p_transfer_id,'matches',v_batch_count
    );
  END IF;

  SELECT * INTO v_batch
  FROM public.raw_material_batches b
  WHERE b.raw_material_id=v_dest.raw_material_id
    AND b.branch_id=v_dest.branch_id
    AND b.warehouse_id=v_dest.warehouse_id
    AND b.batch_number IS NOT DISTINCT FROM v_dest.batch_number
  LIMIT 1
  FOR UPDATE;

  SELECT count(*) INTO v_downstream
  FROM public.inventory_ledger il
  WHERE il.raw_material_id=v_dest.raw_material_id
    AND il.branch_id=v_dest.branch_id
    AND il.warehouse_id=v_dest.warehouse_id
    AND il.batch_number IS NOT DISTINCT FROM v_dest.batch_number
    AND il.quantity<0
    AND (il.created_at>v_dest.created_at OR (il.created_at=v_dest.created_at AND il.id>v_dest.id));

  IF v_downstream>0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_WAREHOUSE_TRANSFER_DOWNSTREAM_CONSUMPTION_REQUIRES_CASCADE',
      'transfer_id',p_transfer_id,
      'destination_ledger_id',v_dest.id,
      'downstream_rows',v_downstream
    );
  END IF;

  IF COALESCE(v_dest.quantity,0)<=0 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_WAREHOUSE_TRANSFER_DESTINATION_QUANTITY_INVALID');
  END IF;

  v_new_total:=COALESCE(v_dest.total_cost,0)+p_delta;
  IF v_new_total < -0.000001 THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_WAREHOUSE_TRANSFER_DESTINATION_COST_NEGATIVE',
      'current_total',v_dest.total_cost,'delta',p_delta
    );
  END IF;

  v_new_total:=GREATEST(v_new_total,0);
  v_new_unit:=v_new_total/v_dest.quantity;

  UPDATE public.warehouse_transfer_items
  SET unit_cost=round(v_new_unit,4)
  WHERE id=v_item.id;

  UPDATE public.inventory_ledger
  SET unit_cost=v_new_unit,total_cost=v_new_total
  WHERE id=v_dest.id;

  UPDATE public.raw_material_batches
  SET unit_cost=v_new_unit
  WHERE id=v_batch.id;

  UPDATE public.raw_material_inventory rmi
  SET avg_cost=COALESCE((
        SELECT CASE
          WHEN COALESCE(sum(b.quantity),0)>0
            THEN round(COALESCE(sum(b.quantity*COALESCE(b.unit_cost,0)),0)/sum(b.quantity),2)
          ELSE 0
        END
        FROM public.raw_material_batches b
        WHERE b.raw_material_id=v_dest.raw_material_id
          AND b.branch_id=v_dest.branch_id
      ),0),
      updated_at=now()
  WHERE rmi.raw_material_id=v_dest.raw_material_id
    AND rmi.branch_id=v_dest.branch_id;

  RETURN jsonb_build_object(
    'success',true,
    'transfer_id',p_transfer_id,
    'destination_branch_id',v_dest.branch_id,
    'destination_raw_material_id',v_dest.raw_material_id,
    'destination_ledger_id',v_dest.id,
    'delta',p_delta,
    'new_unit_cost',v_new_unit,
    'downstream_rows',0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._fifo_adjust_warehouse_transfer_delta(
  uuid,uuid,uuid,text,uuid,numeric
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_warehouse_transfer_delta(
  uuid,uuid,uuid,text,uuid,numeric
) TO service_role,postgres;


CREATE OR REPLACE FUNCTION public._fifo_adjust_reference_delta(p_reference_type text, p_reference_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_target_type text, p_target_id uuid, p_delta numeric, p_depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ref_no text;
  v_entry_date date;
  v_sale_id uuid;
  v_sale_status text;
  v_sale_count integer:=0;
  v_order_count integer:=0;
  v_journal_count integer:=0;
  v_res jsonb;
BEGIN
  IF p_reference_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  IF p_depth>16 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_REFERENCE_PROPAGATION_TOO_DEEP');
  END IF;

  IF p_reference_type='sale' THEN
    RETURN public._fifo_adjust_sale_cogs_delta(p_reference_id,p_delta);

  ELSIF p_reference_type='kitchen_send' THEN
    IF EXISTS (
      SELECT 1
      FROM public.order_kitchen_inventory_events e
      WHERE e.id=p_reference_id
    ) THEN
      RETURN public._fifo_adjust_kitchen_effect_delta(
        p_reference_id,p_target_type,p_target_id,p_delta
      );
    END IF;

    SELECT il.reference_number,(il.created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.inventory_ledger il
    WHERE il.reference_type='kitchen_send'
      AND il.reference_id=p_reference_id
      AND il.branch_id=p_branch_id
    ORDER BY il.created_at,il.id
    LIMIT 1;

    IF v_ref_no IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_NOT_FOUND',
        'reference_id',p_reference_id
      );
    END IF;

    SELECT count(*)
    INTO v_order_count
    FROM public.orders o
    WHERE o.branch_id=p_branch_id
      AND o.order_number=v_ref_no;

    -- Reuse v_sale_id only after the order guard; it is intentionally ignored
    -- for orders because a missing event with a surviving order is not safe to
    -- infer as settled inventory.
    IF v_order_count>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_ORDER',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no,
        'order_matches',v_order_count
      );
    END IF;

    SELECT count(*)
    INTO v_sale_count
    FROM public.sales s
    WHERE s.branch_id=p_branch_id
      AND s.invoice_number=v_ref_no;

    IF v_sale_count=1 THEN
      SELECT s.id,s.status
      INTO v_sale_id,v_sale_status
      FROM public.sales s
      WHERE s.branch_id=p_branch_id
        AND s.invoice_number=v_ref_no
      LIMIT 1;
    END IF;

    SELECT count(*)
    INTO v_journal_count
    FROM public.journal_entries je
    WHERE je.branch_id=p_branch_id
      AND je.reference_id=p_reference_id;

    IF v_journal_count>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_LIVE_REFERENCE',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no,
        'journal_matches',v_journal_count
      );
    END IF;

    IF v_sale_count=1 AND v_sale_status='completed' THEN
      v_res:=public._fifo_adjust_sale_cogs_delta(v_sale_id,p_delta);
      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        RETURN v_res;
      END IF;

      RETURN v_res || jsonb_build_object(
        'historical_sale_fallback',true,
        'missing_kitchen_event_id',p_reference_id,
        'sale_id',v_sale_id,
        'reference_number',v_ref_no,
        'ledger_authoritative',true
      );
    END IF;

    IF v_sale_count>0 THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_KITCHEN_EVENT_MISSING_WITH_AMBIGUOUS_SALE',
        'reference_id',p_reference_id,
        'reference_number',v_ref_no,
        'sale_matches',v_sale_count,
        'sale_status',v_sale_status
      );
    END IF;

    RETURN jsonb_build_object(
      'success',true,
      'delta',p_delta,
      'orphan_reference',true,
      'ledger_only',true,
      'reference_type','kitchen_send',
      'reference_id',p_reference_id,
      'reference_number',v_ref_no
    );

  ELSIF p_reference_type='production' THEN
    RETURN public._fifo_adjust_production_delta(
      p_reference_id,p_delta,p_depth+1
    );

  ELSIF p_reference_type='warehouse_transfer' THEN
    RETURN public._fifo_adjust_warehouse_transfer_delta(
      p_reference_id,p_branch_id,p_warehouse_id,
      p_target_type,p_target_id,p_delta
    );

  ELSIF p_reference_type='purchase_return' THEN
    SELECT invoice_number,(created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.purchases
    WHERE id=p_reference_id;

    IF NOT FOUND THEN
      SELECT il.reference_number,(il.created_at AT TIME ZONE 'Africa/Cairo')::date
      INTO v_ref_no,v_entry_date
      FROM public.inventory_ledger il
      WHERE il.reference_type='purchase_return'
        AND il.reference_id=p_reference_id
        AND il.branch_id=p_branch_id
      ORDER BY il.created_at,il.id
      LIMIT 1;
    END IF;

    IF v_ref_no IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','FIFO_PURCHASE_RETURN_REFERENCE_NOT_FOUND',
        'reference_id',p_reference_id
      );
    END IF;

    RETURN public._fifo_adjust_stock_variance_delta(
      p_branch_id,'purchase_return',p_reference_id,
      v_ref_no,v_entry_date,p_delta
    );
  END IF;

  RETURN jsonb_build_object(
    'success',false,
    'error','FIFO_UNSUPPORTED_REFERENCE_TYPE',
    'reference_type',p_reference_type,
    'reference_id',p_reference_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.raw_fifo_prepare_backfill(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_cutoff bigint;
  e record;
  v_debt record;
  v_lot record;
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_batch_id uuid;
  v_expiry date;
  v_unknown integer;
  v_batch_mismatch integer;
  v_summary jsonb;
BEGIN
  SELECT COALESCE(max(id),0) INTO v_cutoff
  FROM public.inventory_ledger
  WHERE raw_material_id IS NOT NULL
    AND warehouse_id IS NOT NULL
    AND (p_branch_id IS NULL OR branch_id=p_branch_id);

  INSERT INTO public.raw_fifo_backfill_runs(id,branch_id,cutoff_ledger_id,status)
  VALUES(v_run,p_branch_id,v_cutoff,'preparing');

  DROP TABLE IF EXISTS pg_temp.rf_lots;
  DROP TABLE IF EXISTS pg_temp.rf_debts;

  CREATE TEMP TABLE rf_lots(
    id bigserial PRIMARY KEY,
    raw_material_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    receipt_ledger_id bigint NOT NULL,
    batch_id uuid NOT NULL,
    available_qty numeric(18,6) NOT NULL,
    unit_cost numeric(18,6) NOT NULL,
    expiry_date date,
    event_at timestamptz NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE rf_debts(
    id bigserial PRIMARY KEY,
    raw_material_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    consumption_ledger_id bigint NOT NULL,
    oversold_batch_id uuid,
    debt_quantity numeric(18,6) NOT NULL,
    remaining_qty numeric(18,6) NOT NULL,
    event_at timestamptz NOT NULL
  ) ON COMMIT DROP;

  FOR e IN
    SELECT il.*
    FROM public.inventory_ledger il
    WHERE il.raw_material_id IS NOT NULL
      AND il.warehouse_id IS NOT NULL
      AND il.quantity<>0
      AND il.id<=v_cutoff
      AND (p_branch_id IS NULL OR il.branch_id=p_branch_id)
    ORDER BY il.raw_material_id,il.branch_id,il.warehouse_id,il.created_at,il.id
  LOOP
    SELECT b.id,b.expiry_date
    INTO v_batch_id,v_expiry
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=e.raw_material_id
      AND b.branch_id=e.branch_id
      AND b.warehouse_id=e.warehouse_id
      AND b.batch_number IS NOT DISTINCT FROM e.batch_number
    ORDER BY b.created_at,b.id
    LIMIT 1;

    IF v_batch_id IS NULL THEN
      RAISE EXCEPTION 'FIFO_BACKFILL_BATCH_NOT_FOUND ledger=%',e.id;
    END IF;

    IF e.quantity>0 THEN
      v_remaining:=e.quantity;

      FOR v_debt IN
        SELECT *
        FROM rf_debts
        WHERE raw_material_id=e.raw_material_id
          AND branch_id=e.branch_id
          AND warehouse_id=e.warehouse_id
          AND remaining_qty>0
        ORDER BY event_at,id
      LOOP
        EXIT WHEN v_remaining<=0;
        v_take:=LEAST(v_remaining,v_debt.remaining_qty);

        UPDATE public.raw_fifo_backfill_plan
        SET target_cost=target_cost+v_take*COALESCE(e.unit_cost,0),
            unresolved_quantity=GREATEST(unresolved_quantity-v_take,0)
        WHERE run_id=v_run
          AND consumption_ledger_id=v_debt.consumption_ledger_id;

        INSERT INTO public.raw_fifo_backfill_allocations(
          run_id,consumption_ledger_id,receipt_ledger_id,
          allocation_type,quantity,unit_cost,total_cost
        ) VALUES (
          v_run,v_debt.consumption_ledger_id,e.id,
          'debt_settlement',v_take,COALESCE(e.unit_cost,0),
          v_take*COALESCE(e.unit_cost,0)
        );

        UPDATE rf_debts
        SET remaining_qty=remaining_qty-v_take
        WHERE id=v_debt.id;

        v_remaining:=v_remaining-v_take;
      END LOOP;

      IF v_remaining>0 THEN
        INSERT INTO rf_lots(
          raw_material_id,branch_id,warehouse_id,receipt_ledger_id,batch_id,
          available_qty,unit_cost,expiry_date,event_at
        ) VALUES (
          e.raw_material_id,e.branch_id,e.warehouse_id,e.id,v_batch_id,
          v_remaining,COALESCE(e.unit_cost,0),v_expiry,e.created_at
        );
      END IF;
    ELSE
      v_remaining:=-e.quantity;

      INSERT INTO public.raw_fifo_backfill_plan(
        run_id,consumption_ledger_id,raw_material_id,branch_id,warehouse_id,
        reference_type,reference_id,reference_number,entry_type,quantity,
        current_cost,target_cost,debt_quantity,unresolved_quantity,source_created_at
      ) VALUES (
        v_run,e.id,e.raw_material_id,e.branch_id,e.warehouse_id,
        e.reference_type,e.reference_id,e.reference_number,e.entry_type,
        -e.quantity,GREATEST(-COALESCE(e.total_cost,0),0),0,0,0,e.created_at
      );

      FOR v_lot IN
        SELECT *
        FROM rf_lots
        WHERE raw_material_id=e.raw_material_id
          AND branch_id=e.branch_id
          AND warehouse_id=e.warehouse_id
          AND available_qty>0
        ORDER BY expiry_date NULLS LAST,event_at,receipt_ledger_id,id
      LOOP
        EXIT WHEN v_remaining<=0;
        v_take:=LEAST(v_remaining,v_lot.available_qty);

        UPDATE public.raw_fifo_backfill_plan
        SET target_cost=target_cost+v_take*v_lot.unit_cost
        WHERE run_id=v_run AND consumption_ledger_id=e.id;

        INSERT INTO public.raw_fifo_backfill_allocations(
          run_id,consumption_ledger_id,receipt_ledger_id,
          allocation_type,quantity,unit_cost,total_cost
        ) VALUES (
          v_run,e.id,v_lot.receipt_ledger_id,'fifo',v_take,v_lot.unit_cost,v_take*v_lot.unit_cost
        );

        UPDATE rf_lots SET available_qty=available_qty-v_take WHERE id=v_lot.id;
        v_remaining:=v_remaining-v_take;
      END LOOP;

      IF v_remaining>0 THEN
        INSERT INTO rf_debts(
          raw_material_id,branch_id,warehouse_id,consumption_ledger_id,
          oversold_batch_id,debt_quantity,remaining_qty,event_at
        ) VALUES (
          e.raw_material_id,e.branch_id,e.warehouse_id,e.id,
          v_batch_id,
          v_remaining,v_remaining,e.created_at
        );

        UPDATE public.raw_fifo_backfill_plan
        SET debt_quantity=v_remaining,
            unresolved_quantity=v_remaining
        WHERE run_id=v_run AND consumption_ledger_id=e.id;
      END IF;
    END IF;
  END LOOP;

  -- Target residual quantities for positive receipt batches.
  INSERT INTO public.raw_fifo_backfill_batch_plan(
    run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
  )
  SELECT
    v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,
    COALESCE(sum(l.available_qty),0)
  FROM public.raw_material_batches b
  JOIN (
    SELECT DISTINCT batch_id FROM rf_lots
  ) x ON x.batch_id=b.id
  LEFT JOIN rf_lots l ON l.batch_id=b.id
  GROUP BY b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity;

  -- Target residual quantities for historical oversold debt batches.
  INSERT INTO public.raw_fifo_backfill_batch_plan(
    run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
  )
  SELECT
    v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,
    -COALESCE(sum(d.remaining_qty),0)
  FROM public.raw_material_batches b
  JOIN (
    SELECT DISTINCT oversold_batch_id
    FROM rf_debts WHERE oversold_batch_id IS NOT NULL
  ) x ON x.oversold_batch_id=b.id
  LEFT JOIN rf_debts d ON d.oversold_batch_id=b.id
  GROUP BY b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity
  ON CONFLICT(run_id,batch_id) DO UPDATE
  SET target_quantity=EXCLUDED.target_quantity;

  -- Include positive receipt batches fully exhausted during replay.
  INSERT INTO public.raw_fifo_backfill_batch_plan(
    run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
  )
  SELECT DISTINCT
    v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,0
  FROM public.raw_fifo_backfill_allocations a
  JOIN public.inventory_ledger r ON r.id=a.receipt_ledger_id
  JOIN public.raw_material_batches b
    ON b.raw_material_id=r.raw_material_id
   AND b.branch_id=r.branch_id
   AND b.warehouse_id=r.warehouse_id
   AND b.batch_number IS NOT DISTINCT FROM r.batch_number
  WHERE a.run_id=v_run
  ON CONFLICT(run_id,batch_id) DO NOTHING;

  SELECT count(*) INTO v_unknown
  FROM public.raw_fifo_backfill_plan p
  WHERE p.run_id=v_run
    AND abs(p.target_cost-p.current_cost)>0.005
    AND COALESCE(p.reference_type,'') NOT IN (
      'sale','kitchen_send','production','purchase_return','warehouse_transfer'
    );

  IF v_unknown>0 THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_UNSUPPORTED_CHANGED_REFERENCES count=%',v_unknown;
  END IF;

  -- Replay must preserve net stock quantity per raw/branch/warehouse.
  SELECT count(*) INTO v_batch_mismatch
  FROM (
    SELECT
      bp.raw_material_id,bp.branch_id,bp.warehouse_id,
      sum(bp.target_quantity) target_qty,
      (
        SELECT COALESCE(sum(il.quantity),0)
        FROM public.inventory_ledger il
        WHERE il.raw_material_id=bp.raw_material_id
          AND il.branch_id=bp.branch_id
          AND il.warehouse_id=bp.warehouse_id
          AND il.id<=v_cutoff
      ) ledger_qty
    FROM public.raw_fifo_backfill_batch_plan bp
    WHERE bp.run_id=v_run
    GROUP BY bp.raw_material_id,bp.branch_id,bp.warehouse_id
  ) q
  WHERE abs(q.target_qty-q.ledger_qty)>0.0001;

  -- The batch plan only contains batches touched by replay. Add untouched current
  -- batches before validating totals.
  IF v_batch_mismatch>0 THEN
    DELETE FROM public.raw_fifo_backfill_batch_plan WHERE run_id=v_run;

    INSERT INTO public.raw_fifo_backfill_batch_plan(
      run_id,batch_id,raw_material_id,branch_id,warehouse_id,current_quantity,target_quantity
    )
    SELECT
      v_run,b.id,b.raw_material_id,b.branch_id,b.warehouse_id,b.quantity,
      COALESCE((
        SELECT sum(l.available_qty)
        FROM rf_lots l WHERE l.batch_id=b.id
      ),0)
      - COALESCE((
        SELECT sum(d.remaining_qty)
        FROM rf_debts d WHERE d.oversold_batch_id=b.id
      ),0)
    FROM public.raw_material_batches b
    WHERE (p_branch_id IS NULL OR b.branch_id=p_branch_id)
      AND EXISTS(
        SELECT 1 FROM public.inventory_ledger il
        WHERE il.raw_material_id=b.raw_material_id
          AND il.branch_id=b.branch_id
          AND il.warehouse_id=b.warehouse_id
          AND il.batch_number IS NOT DISTINCT FROM b.batch_number
          AND il.id<=v_cutoff
      );

    SELECT count(*) INTO v_batch_mismatch
    FROM (
      SELECT
        bp.raw_material_id,bp.branch_id,bp.warehouse_id,
        sum(bp.target_quantity) target_qty,
        (
          SELECT COALESCE(sum(il.quantity),0)
          FROM public.inventory_ledger il
          WHERE il.raw_material_id=bp.raw_material_id
            AND il.branch_id=bp.branch_id
            AND il.warehouse_id=bp.warehouse_id
            AND il.id<=v_cutoff
        ) ledger_qty
      FROM public.raw_fifo_backfill_batch_plan bp
      WHERE bp.run_id=v_run
      GROUP BY bp.raw_material_id,bp.branch_id,bp.warehouse_id
    ) q
    WHERE abs(q.target_qty-q.ledger_qty)>0.0001;
  END IF;

  IF v_batch_mismatch>0 THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_NET_QUANTITY_MISMATCH count=%',v_batch_mismatch;
  END IF;

  SELECT jsonb_build_object(
    'run_id',v_run,
    'branch_id',p_branch_id,
    'cutoff_ledger_id',v_cutoff,
    'consumption_rows',count(*),
    'changed_rows',count(*) FILTER (WHERE abs(target_cost-current_cost)>0.005),
    'positive_delta_rows',count(*) FILTER (WHERE target_cost-current_cost>0.005),
    'negative_delta_rows',count(*) FILTER (WHERE current_cost-target_cost>0.005),
    'net_cost_delta',round(COALESCE(sum(target_cost-current_cost),0),2),
    'debt_quantity',round(COALESCE(sum(debt_quantity),0),4),
    'unresolved_quantity',round(COALESCE(sum(unresolved_quantity),0),4),
    'unresolved_rows',count(*) FILTER (WHERE unresolved_quantity>0)
  )
  INTO v_summary
  FROM public.raw_fifo_backfill_plan
  WHERE run_id=v_run;

  UPDATE public.raw_fifo_backfill_runs
  SET status='prepared',summary=v_summary
  WHERE id=v_run;

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_backfill_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=v_run;
  RAISE;
END;
$function$
;

COMMIT;
