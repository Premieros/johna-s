-- Complete warehouse-transfer support inside FIFO apply guard.
-- This migration changes only the supported-reference allow-list in raw_fifo_apply_backfill.
BEGIN;

CREATE OR REPLACE FUNCTION public.raw_fifo_apply_backfill(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_fifo_backfill_runs%ROWTYPE;
  v_latest bigint;
  v_changed integer;
  v_batch_changed integer;
  v_row record;
  v_debt_id uuid;
  v_batch_id uuid;
  v_res jsonb;
  v_existing_debt public.raw_fifo_debts%ROWTYPE;
  v_settlement_mismatch integer;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_backfill_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_BACKFILL_RUN_NOT_FOUND');
  END IF;

  IF v_run.status='applied' THEN
    RETURN jsonb_build_object('success',true,'already_applied',true,'run_id',v_run.id);
  END IF;

  IF v_run.status<>'prepared' THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_BACKFILL_NOT_PREPARED','status',v_run.status
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('raw-fifo-backfill:'||COALESCE(v_run.branch_id::text,'all'),0)
  );

  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_plan
    WHERE run_id=p_run_id
    ORDER BY branch_id,raw_material_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );
  END LOOP;

  SELECT COALESCE(max(id),0) INTO v_latest
  FROM public.inventory_ledger
  WHERE raw_material_id IS NOT NULL
    AND warehouse_id IS NOT NULL
    AND (v_run.branch_id IS NULL OR branch_id=v_run.branch_id);

  IF v_latest<>v_run.cutoff_ledger_id THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_STALE_PLAN',
      'prepared_cutoff',v_run.cutoff_ledger_id,
      'current_cutoff',v_latest
    );
  END IF;

  SELECT count(*) INTO v_batch_changed
  FROM public.raw_fifo_backfill_batch_plan bp
  JOIN public.raw_material_batches b ON b.id=bp.batch_id
  WHERE bp.run_id=p_run_id
    AND abs(b.quantity-bp.current_quantity)>0.0001;

  IF v_batch_changed>0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_BATCHES_CHANGED',
      'changed_batches',v_batch_changed
    );
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.raw_fifo_backfill_plan p
  WHERE p.run_id=p_run_id
    AND abs(p.target_cost-p.current_cost)>0.005
    AND (
      p.reference_id IS NULL
      OR COALESCE(p.reference_type,'') NOT IN (
        'sale','kitchen_send','production','purchase_return','warehouse_transfer'
      )
    );

  IF v_changed>0 THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_UNSUPPORTED_REFERENCE',
      'rows',v_changed
    );
  END IF;

  UPDATE public.raw_fifo_backfill_runs
  SET status='applying'
  WHERE id=p_run_id;

  -- Materialize historical debt identity and settlement audit first.
  FOR v_row IN
    SELECT p.*,il.batch_number
    FROM public.raw_fifo_backfill_plan p
    JOIN public.inventory_ledger il ON il.id=p.consumption_ledger_id
    WHERE p.run_id=p_run_id AND p.debt_quantity>0
    ORDER BY p.source_created_at,p.consumption_ledger_id
  LOOP
    SELECT b.id INTO v_batch_id
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=v_row.raw_material_id
      AND b.branch_id=v_row.branch_id
      AND b.warehouse_id=v_row.warehouse_id
      AND b.batch_number IS NOT DISTINCT FROM v_row.batch_number
    ORDER BY b.created_at,b.id
    LIMIT 1;

    v_debt_id:=NULL;

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at,backfill_run_id
    ) VALUES (
      v_row.consumption_ledger_id,v_row.raw_material_id,v_row.branch_id,v_row.warehouse_id,
      v_batch_id,
      v_row.reference_type,v_row.reference_id,v_row.reference_number,
      v_row.debt_quantity,v_row.debt_quantity-v_row.unresolved_quantity,v_row.source_created_at,
      p_run_id
    )
    ON CONFLICT(source_ledger_id) DO NOTHING
    RETURNING id INTO v_debt_id;

    IF v_debt_id IS NULL THEN
      SELECT * INTO v_existing_debt
      FROM public.raw_fifo_debts
      WHERE source_ledger_id=v_row.consumption_ledger_id
      FOR UPDATE;

      IF v_existing_debt.id IS NULL THEN
        RAISE EXCEPTION 'FIFO_BACKFILL_EXISTING_DEBT_NOT_FOUND ledger=%',
          v_row.consumption_ledger_id;
      END IF;

      IF v_existing_debt.raw_material_id IS DISTINCT FROM v_row.raw_material_id
         OR v_existing_debt.branch_id IS DISTINCT FROM v_row.branch_id
         OR v_existing_debt.warehouse_id IS DISTINCT FROM v_row.warehouse_id
         OR abs(v_existing_debt.debt_quantity-v_row.debt_quantity)>0.000001
         OR abs(
           v_existing_debt.settled_quantity
           -(v_row.debt_quantity-v_row.unresolved_quantity)
         )>0.000001 THEN
        RAISE EXCEPTION
          'FIFO_BACKFILL_EXISTING_DEBT_MISMATCH ledger=% current_debt=% target_debt=% current_settled=% target_settled=%',
          v_row.consumption_ledger_id,
          v_existing_debt.debt_quantity,
          v_row.debt_quantity,
          v_existing_debt.settled_quantity,
          v_row.debt_quantity-v_row.unresolved_quantity;
      END IF;

      v_debt_id:=v_existing_debt.id;
    END IF;

    SELECT count(*) INTO v_settlement_mismatch
    FROM public.raw_fifo_backfill_allocations a
    JOIN public.inventory_ledger r ON r.id=a.receipt_ledger_id
    JOIN public.raw_material_batches b
      ON b.raw_material_id=r.raw_material_id
     AND b.branch_id=r.branch_id
     AND b.warehouse_id=r.warehouse_id
     AND b.batch_number IS NOT DISTINCT FROM r.batch_number
    JOIN public.raw_fifo_settlements s
      ON s.debt_id=v_debt_id
     AND s.receipt_ledger_id=a.receipt_ledger_id
    WHERE a.run_id=p_run_id
      AND a.consumption_ledger_id=v_row.consumption_ledger_id
      AND a.allocation_type='debt_settlement'
      AND (
        abs(s.quantity-a.quantity)>0.000001
        OR abs(s.unit_cost-a.unit_cost)>0.000001
        OR abs(s.total_cost-a.total_cost)>0.000001
        OR s.receipt_batch_id IS DISTINCT FROM b.id
      );

    IF v_settlement_mismatch>0 THEN
      RAISE EXCEPTION
        'FIFO_BACKFILL_EXISTING_SETTLEMENT_MISMATCH ledger=% count=%',
        v_row.consumption_ledger_id,v_settlement_mismatch;
    END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    )
    SELECT
      v_debt_id,a.receipt_ledger_id,b.id,
      a.quantity,a.unit_cost,a.total_cost,p_run_id
    FROM public.raw_fifo_backfill_allocations a
    JOIN public.inventory_ledger r ON r.id=a.receipt_ledger_id
    JOIN public.raw_material_batches b
      ON b.raw_material_id=r.raw_material_id
     AND b.branch_id=r.branch_id
     AND b.warehouse_id=r.warehouse_id
     AND b.batch_number IS NOT DISTINCT FROM r.batch_number
    WHERE a.run_id=p_run_id
      AND a.consumption_ledger_id=v_row.consumption_ledger_id
      AND a.allocation_type='debt_settlement'
    ON CONFLICT(debt_id,receipt_ledger_id) DO NOTHING;
  END LOOP;

  -- Apply signed valuation deltas to source references in source chronological order.
  FOR v_row IN
    SELECT p.*
    FROM public.raw_fifo_backfill_plan p
    WHERE p.run_id=p_run_id
      AND abs(p.target_cost-p.current_cost)>0.005
    ORDER BY p.source_created_at,p.consumption_ledger_id
  LOOP
    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,v_row.reference_id,
      v_row.branch_id,v_row.warehouse_id,
      'raw_material',v_row.raw_material_id,
      v_row.target_cost-v_row.current_cost,
      0
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIFO_BACKFILL_REFERENCE_FAILED ledger=% detail=%',
        v_row.consumption_ledger_id,v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=-v_row.target_cost,
        unit_cost=CASE
          WHEN v_row.quantity>0 THEN v_row.target_cost/v_row.quantity
          ELSE 0
        END
    WHERE id=v_row.consumption_ledger_id;
  END LOOP;

  -- Normalize historical per-batch residuals without changing aggregate stock.
  UPDATE public.raw_material_batches b
  SET quantity=bp.target_quantity
  FROM public.raw_fifo_backfill_batch_plan bp
  WHERE bp.run_id=p_run_id AND bp.batch_id=b.id;

  -- Refresh branch aggregate cache from canonical batches.
  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_batch_plan
    WHERE run_id=p_run_id
  LOOP
    INSERT INTO public.raw_material_inventory(
      raw_material_id,branch_id,quantity,avg_cost
    )
    SELECT
      v_row.raw_material_id,v_row.branch_id,
      COALESCE(sum(b.quantity),0),
      CASE
        WHEN COALESCE(sum(b.quantity),0)>0 THEN
          round(
            COALESCE(sum(b.quantity*COALESCE(b.unit_cost,0)),0)
            / sum(b.quantity),
            2
          )
        ELSE 0
      END
    FROM public.raw_material_batches b
    WHERE b.raw_material_id=v_row.raw_material_id
      AND b.branch_id=v_row.branch_id
    ON CONFLICT(raw_material_id,branch_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,
        avg_cost=EXCLUDED.avg_cost,
        updated_at=now();
  END LOOP;

  UPDATE public.raw_fifo_backfill_runs
  SET status='applied',applied_at=now()
  WHERE id=p_run_id;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',p_run_id,
    'summary',v_run.summary
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_backfill_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;

COMMIT;
