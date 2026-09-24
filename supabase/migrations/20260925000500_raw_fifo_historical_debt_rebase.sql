-- Audited, reversible rebase for fully-settled historical FIFO debt state.
-- Required when later historical ledger corrections change which receipt settled
-- an older backfill-created debt. This migration never auto-runs a backfill.
BEGIN;

CREATE TABLE IF NOT EXISTS public.raw_fifo_debt_rebase_snapshots (
  run_id uuid NOT NULL REFERENCES public.raw_fifo_backfill_runs(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL REFERENCES public.raw_fifo_debts(id) ON DELETE RESTRICT,
  source_ledger_id bigint NOT NULL,
  original_debt_quantity numeric(18,6) NOT NULL,
  original_settled_quantity numeric(18,6) NOT NULL,
  original_backfill_run_id uuid,
  original_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  PRIMARY KEY(run_id,debt_id)
);

CREATE TABLE IF NOT EXISTS public.raw_fifo_debt_rebase_settlement_snapshots (
  run_id uuid NOT NULL REFERENCES public.raw_fifo_backfill_runs(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL REFERENCES public.raw_fifo_debts(id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL,
  receipt_ledger_id bigint NOT NULL,
  receipt_batch_id uuid,
  quantity numeric(18,6) NOT NULL,
  unit_cost numeric(18,6) NOT NULL,
  total_cost numeric(18,6) NOT NULL,
  reconciliation_status text NOT NULL,
  reconciliation_error text,
  original_run_id uuid,
  original_created_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,settlement_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_fifo_debt_rebase_snapshots_debt
  ON public.raw_fifo_debt_rebase_snapshots(debt_id,run_id);
CREATE INDEX IF NOT EXISTS idx_raw_fifo_debt_rebase_settlement_snapshots_debt
  ON public.raw_fifo_debt_rebase_settlement_snapshots(run_id,debt_id);

ALTER TABLE public.raw_fifo_debt_rebase_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_debt_rebase_settlement_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raw_fifo_debt_rebase_snapshots
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_debt_rebase_settlement_snapshots
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.raw_fifo_debt_rebase_snapshots TO service_role,postgres;
GRANT ALL ON public.raw_fifo_debt_rebase_settlement_snapshots TO service_role,postgres;

CREATE OR REPLACE FUNCTION public._raw_fifo_rebase_historical_debt_state(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run public.raw_fifo_backfill_runs%ROWTYPE;
  v_row record;
  v_debt public.raw_fifo_debts%ROWTYPE;
  v_rebased integer:=0;
  v_settlements integer:=0;
  v_inserted integer:=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_backfill_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_DEBT_REBASE_RUN_NOT_FOUND');
  END IF;

  IF v_run.status<>'applying' THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_DEBT_REBASE_RUN_NOT_APPLYING','status',v_run.status
    );
  END IF;

  FOR v_row IN
    WITH target_state AS (
      SELECT p.consumption_ledger_id source_ledger_id,
             p.debt_quantity target_debt,
             (p.debt_quantity-p.unresolved_quantity) target_settled
      FROM public.raw_fifo_backfill_plan p
      WHERE p.run_id=p_run_id
        AND p.debt_quantity>0
    ),
    target_set AS (
      SELECT p.consumption_ledger_id source_ledger_id,
             a.receipt_ledger_id,
             sum(a.quantity)::numeric(18,6) qty,
             max(a.unit_cost)::numeric(18,6) unit_cost,
             sum(a.total_cost)::numeric(18,6) total_cost
      FROM public.raw_fifo_backfill_allocations a
      JOIN public.raw_fifo_backfill_plan p
        ON p.run_id=a.run_id
       AND p.consumption_ledger_id=a.consumption_ledger_id
      WHERE a.run_id=p_run_id
        AND a.allocation_type='debt_settlement'
      GROUP BY p.consumption_ledger_id,a.receipt_ledger_id
    ),
    current_set AS (
      SELECT d.source_ledger_id,
             s.receipt_ledger_id,
             sum(s.quantity)::numeric(18,6) qty,
             max(s.unit_cost)::numeric(18,6) unit_cost,
             sum(s.total_cost)::numeric(18,6) total_cost
      FROM public.raw_fifo_debts d
      JOIN target_state t ON t.source_ledger_id=d.source_ledger_id
      JOIN public.raw_fifo_settlements s ON s.debt_id=d.id
      GROUP BY d.source_ledger_id,s.receipt_ledger_id
    ),
    settlement_diff AS (
      SELECT DISTINCT COALESCE(c.source_ledger_id,t.source_ledger_id) source_ledger_id
      FROM current_set c
      FULL JOIN target_set t
        ON t.source_ledger_id=c.source_ledger_id
       AND t.receipt_ledger_id=c.receipt_ledger_id
      WHERE c.source_ledger_id IS NULL
         OR t.source_ledger_id IS NULL
         OR abs(c.qty-t.qty)>0.000001
         OR abs(c.unit_cost-t.unit_cost)>0.000001
         OR abs(c.total_cost-t.total_cost)>0.000001
    )
    SELECT d.id debt_id,d.source_ledger_id,
           t.target_debt,t.target_settled
    FROM target_state t
    JOIN public.raw_fifo_debts d ON d.source_ledger_id=t.source_ledger_id
    LEFT JOIN settlement_diff sd ON sd.source_ledger_id=t.source_ledger_id
    WHERE abs(d.debt_quantity-t.target_debt)>0.000001
       OR abs(d.settled_quantity-t.target_settled)>0.000001
       OR sd.source_ledger_id IS NOT NULL
    ORDER BY d.source_created_at,d.source_ledger_id
  LOOP
    SELECT * INTO v_debt
    FROM public.raw_fifo_debts
    WHERE id=v_row.debt_id
    FOR UPDATE;

    IF v_debt.id IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_REBASE_DEBT_NOT_FOUND',
        'source_ledger_id',v_row.source_ledger_id
      );
    END IF;

    IF v_debt.backfill_run_id IS NULL THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_REBASE_LIVE_DEBT_REFUSED',
        'source_ledger_id',v_debt.source_ledger_id
      );
    END IF;

    IF abs(v_debt.settled_quantity-v_debt.debt_quantity)>0.000001 THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_REBASE_CURRENT_NOT_FULLY_SETTLED',
        'source_ledger_id',v_debt.source_ledger_id
      );
    END IF;

    IF v_row.target_debt<=0
       OR abs(v_row.target_settled-v_row.target_debt)>0.000001
       OR v_row.target_debt-v_debt.debt_quantity>0.000001 THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_REBASE_TARGET_UNSAFE',
        'source_ledger_id',v_debt.source_ledger_id,
        'current_debt',v_debt.debt_quantity,
        'target_debt',v_row.target_debt,
        'target_settled',v_row.target_settled
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.raw_fifo_debt_rebase_snapshots s
      WHERE s.debt_id=v_debt.id
        AND s.run_id<>p_run_id
        AND s.restored_at IS NULL
    ) THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_REBASE_ACTIVE_SNAPSHOT_EXISTS',
        'source_ledger_id',v_debt.source_ledger_id
      );
    END IF;

    INSERT INTO public.raw_fifo_debt_rebase_snapshots(
      run_id,debt_id,source_ledger_id,
      original_debt_quantity,original_settled_quantity,
      original_backfill_run_id,original_updated_at
    ) VALUES (
      p_run_id,v_debt.id,v_debt.source_ledger_id,
      v_debt.debt_quantity,v_debt.settled_quantity,
      v_debt.backfill_run_id,v_debt.updated_at
    )
    ON CONFLICT(run_id,debt_id) DO NOTHING;

    INSERT INTO public.raw_fifo_debt_rebase_settlement_snapshots(
      run_id,debt_id,settlement_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,reconciliation_status,reconciliation_error,
      original_run_id,original_created_at
    )
    SELECT
      p_run_id,s.debt_id,s.id,s.receipt_ledger_id,s.receipt_batch_id,
      s.quantity,s.unit_cost,s.total_cost,s.reconciliation_status,s.reconciliation_error,
      s.run_id,s.created_at
    FROM public.raw_fifo_settlements s
    WHERE s.debt_id=v_debt.id
    ON CONFLICT(run_id,settlement_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_settlements:=v_settlements+v_inserted;

    DELETE FROM public.raw_fifo_settlements
    WHERE debt_id=v_debt.id;

    UPDATE public.raw_fifo_debts
    SET debt_quantity=v_row.target_debt,
        settled_quantity=v_row.target_settled,
        updated_at=now()
    WHERE id=v_debt.id;

    v_rebased:=v_rebased+1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',p_run_id,
    'rebased_debts',v_rebased,
    'snapshotted_settlements',v_settlements
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._raw_fifo_restore_rebased_debt_state(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run public.raw_fifo_backfill_runs%ROWTYPE;
  v_row public.raw_fifo_debt_rebase_snapshots%ROWTYPE;
  v_remaining integer;
  v_restored integer:=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_backfill_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_DEBT_RESTORE_RUN_NOT_FOUND');
  END IF;

  IF v_run.status<>'reversing' THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_DEBT_RESTORE_RUN_NOT_REVERSING','status',v_run.status
    );
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.raw_fifo_debt_rebase_snapshots
    WHERE run_id=p_run_id
      AND restored_at IS NULL
    ORDER BY source_ledger_id
    FOR UPDATE
  LOOP
    PERFORM 1
    FROM public.raw_fifo_debts
    WHERE id=v_row.debt_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_RESTORE_DEBT_NOT_FOUND',
        'source_ledger_id',v_row.source_ledger_id
      );
    END IF;

    SELECT count(*) INTO v_remaining
    FROM public.raw_fifo_settlements
    WHERE debt_id=v_row.debt_id;

    IF v_remaining>0 THEN
      RETURN jsonb_build_object(
        'success',false,'error','FIFO_DEBT_RESTORE_SETTLEMENTS_STILL_PRESENT',
        'source_ledger_id',v_row.source_ledger_id,
        'settlements',v_remaining
      );
    END IF;

    UPDATE public.raw_fifo_debts
    SET debt_quantity=v_row.original_debt_quantity,
        settled_quantity=v_row.original_settled_quantity,
        backfill_run_id=v_row.original_backfill_run_id,
        updated_at=v_row.original_updated_at
    WHERE id=v_row.debt_id;

    INSERT INTO public.raw_fifo_settlements(
      id,debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,reconciliation_status,reconciliation_error,
      run_id,created_at
    )
    SELECT
      s.settlement_id,s.debt_id,s.receipt_ledger_id,s.receipt_batch_id,
      s.quantity,s.unit_cost,s.total_cost,s.reconciliation_status,s.reconciliation_error,
      s.original_run_id,s.original_created_at
    FROM public.raw_fifo_debt_rebase_settlement_snapshots s
    WHERE s.run_id=p_run_id
      AND s.debt_id=v_row.debt_id;

    UPDATE public.raw_fifo_debt_rebase_snapshots
    SET restored_at=now()
    WHERE run_id=p_run_id
      AND debt_id=v_row.debt_id;

    v_restored:=v_restored+1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',p_run_id,
    'restored_debts',v_restored
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._raw_fifo_rebase_historical_debt_state(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._raw_fifo_restore_rebased_debt_state(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._raw_fifo_rebase_historical_debt_state(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._raw_fifo_restore_rebased_debt_state(uuid)
  TO service_role,postgres;


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

  -- Rebase only audited, fully-settled historical debt rows whose current
  -- receipt-allocation map differs from this replay. This is valuation-neutral:
  -- source-reference cost deltas are still applied below from current_cost to target_cost.
  v_res:=public._raw_fifo_rebase_historical_debt_state(p_run_id);
  IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_DEBT_REBASE_FAILED detail=%',v_res;
  END IF;

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

CREATE OR REPLACE FUNCTION public.raw_fifo_reverse_backfill(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.raw_fifo_backfill_runs%ROWTYPE;
  v_latest bigint;
  v_row record;
  v_res jsonb;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_backfill_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_RUN_NOT_FOUND'
    );
  END IF;

  IF v_run.status='reversed' THEN
    RETURN jsonb_build_object(
      'success',true,
      'already_reversed',true,
      'run_id',v_run.id
    );
  END IF;

  IF v_run.status<>'applied' THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_NOT_APPLIED',
      'status',v_run.status
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'raw-fifo-backfill:'||COALESCE(v_run.branch_id::text,'all'),
      0
    )
  );

  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_plan
    WHERE run_id=p_run_id
    ORDER BY branch_id,raw_material_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        v_row.raw_material_id::text||':'||v_row.branch_id::text,
        0
      )
    );
  END LOOP;

  SELECT COALESCE(max(id),0)
  INTO v_latest
  FROM public.inventory_ledger
  WHERE raw_material_id IS NOT NULL
    AND warehouse_id IS NOT NULL
    AND (v_run.branch_id IS NULL OR branch_id=v_run.branch_id);

  IF v_latest<>v_run.cutoff_ledger_id THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_BACKFILL_REVERSE_STALE',
      'backfill_cutoff',v_run.cutoff_ledger_id,
      'current_cutoff',v_latest
    );
  END IF;

  UPDATE public.raw_fifo_backfill_runs
  SET status='reversing',
      reverse_error_text=NULL
  WHERE id=p_run_id;

  -- Undo valuation propagation in reverse source order.
  FOR v_row IN
    SELECT p.*
    FROM public.raw_fifo_backfill_plan p
    WHERE p.run_id=p_run_id
      AND abs(p.target_cost-p.current_cost)>0.005
    ORDER BY p.source_created_at DESC,p.consumption_ledger_id DESC
  LOOP
    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,
      v_row.reference_id,
      v_row.branch_id,
      v_row.warehouse_id,
      'raw_material',
      v_row.raw_material_id,
      -(v_row.target_cost-v_row.current_cost),
      0
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION
        'FIFO_BACKFILL_REVERSE_REFERENCE_FAILED ledger=% detail=%',
        v_row.consumption_ledger_id,
        v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=-v_row.current_cost,
        unit_cost=CASE
          WHEN v_row.quantity>0
            THEN v_row.current_cost/v_row.quantity
          ELSE 0
        END
    WHERE id=v_row.consumption_ledger_id;
  END LOOP;

  -- Restore exact pre-backfill batch residual quantities.
  UPDATE public.raw_material_batches b
  SET quantity=bp.current_quantity
  FROM public.raw_fifo_backfill_batch_plan bp
  WHERE bp.run_id=p_run_id
    AND bp.batch_id=b.id;

  -- Remove only historical settlement/debt rows materialized by this run.
  DELETE FROM public.raw_fifo_settlements s
  WHERE s.run_id=p_run_id;

  DELETE FROM public.raw_fifo_debts d
  WHERE d.backfill_run_id=p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.raw_fifo_settlements s
      WHERE s.debt_id=d.id
    );

  -- Restore any older historical debt/settlement state that this run
  -- temporarily rebased before rebuilding the current replay allocation map.
  v_res:=public._raw_fifo_restore_rebased_debt_state(p_run_id);
  IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FIFO_BACKFILL_DEBT_REBASE_RESTORE_FAILED detail=%',v_res;
  END IF;

  -- Remove zeroed reconciliation journal shells produced solely by this run.
  DELETE FROM public.journal_entries je
  USING public.raw_fifo_sale_cogs_adjustments a
  WHERE a.journal_entry_id=je.id
    AND abs(a.exact_delta)<=0.005
    AND abs(a.posted_delta)<=0.005
    AND je.reference_type='fifo_cogs_reconcile';

  UPDATE public.raw_fifo_sale_cogs_adjustments
  SET journal_entry_id=NULL
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id=raw_fifo_sale_cogs_adjustments.journal_entry_id
    );

  DELETE FROM public.raw_fifo_sale_cogs_adjustments
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NULL;

  DELETE FROM public.journal_entries je
  USING public.raw_fifo_stock_adjustments a
  WHERE a.journal_entry_id=je.id
    AND abs(a.exact_delta)<=0.005
    AND abs(a.posted_delta)<=0.005
    AND je.reference_type='fifo_stock_reconcile';

  UPDATE public.raw_fifo_stock_adjustments
  SET journal_entry_id=NULL
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id=raw_fifo_stock_adjustments.journal_entry_id
    );

  DELETE FROM public.raw_fifo_stock_adjustments
  WHERE abs(exact_delta)<=0.005
    AND abs(posted_delta)<=0.005
    AND journal_entry_id IS NULL;

  -- Refresh branch aggregate cache from restored canonical batches.
  FOR v_row IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_fifo_backfill_batch_plan
    WHERE run_id=p_run_id
  LOOP
    INSERT INTO public.raw_material_inventory(
      raw_material_id,branch_id,quantity,avg_cost
    )
    SELECT
      v_row.raw_material_id,
      v_row.branch_id,
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
  SET status='reversed',
      reversed_at=now(),
      reverse_error_text=NULL
  WHERE id=p_run_id;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',p_run_id,
    'reversed',true
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_backfill_runs
  SET status='failed',
      reverse_error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$
;

COMMIT;
