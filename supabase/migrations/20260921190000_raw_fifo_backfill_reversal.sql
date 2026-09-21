-- Emergency reversal for an applied historical FIFO backfill.
-- This is intentionally additive and guarded.
-- It can only reverse while no raw-material ledger movement has occurred
-- after the backfill cutoff. If live stock moved, reversal stops instead
-- of guessing or replaying inventory.

BEGIN;

ALTER TABLE public.raw_fifo_backfill_runs
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverse_error_text text;

ALTER TABLE public.raw_fifo_backfill_runs
  DROP CONSTRAINT IF EXISTS raw_fifo_backfill_runs_status_check;

ALTER TABLE public.raw_fifo_backfill_runs
  ADD CONSTRAINT raw_fifo_backfill_runs_status_check
  CHECK (status IN (
    'preparing','prepared','applying','applied',
    'reversing','reversed','cancelled','failed'
  ));

CREATE OR REPLACE FUNCTION public.raw_fifo_reverse_backfill(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
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
  USING public.raw_fifo_backfill_plan p
  WHERE p.run_id=p_run_id
    AND p.debt_quantity>0
    AND d.source_ledger_id=p.consumption_ledger_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.raw_fifo_settlements s
      WHERE s.debt_id=d.id
    );

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
$function$;

REVOKE ALL ON FUNCTION public.raw_fifo_reverse_backfill(uuid)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.raw_fifo_reverse_backfill(uuid)
  TO service_role,postgres;

COMMIT;
