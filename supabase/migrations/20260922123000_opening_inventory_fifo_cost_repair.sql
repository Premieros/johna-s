-- Repair zero-cost positive raw opening inventory valuation by reusing the
-- existing audited FIFO historical reconciliation engine.
--
-- Safety:
--   * migration defines prepare/apply/reverse only; it never auto-runs a repair;
--   * opening quantities and all stock movement quantities remain unchanged;
--   * only an exact opening batch + exact positive opening ledger row may change;
--   * candidate costs come only from authoritative purchase/count/pricing events;
--   * rows without an authoritative candidate remain unresolved and untouched;
--   * historical valuation propagation is delegated to raw_fifo_prepare/apply_backfill.
BEGIN;

CREATE TABLE IF NOT EXISTS public.raw_opening_cost_repair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing','prepared','applying','applied','reversing','reversed','failed','cancelled')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  fifo_backfill_run_id uuid REFERENCES public.raw_fifo_backfill_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reversed_at timestamptz,
  error_text text
);

CREATE TABLE IF NOT EXISTS public.raw_opening_cost_repair_plan (
  run_id uuid NOT NULL
    REFERENCES public.raw_opening_cost_repair_runs(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL
    REFERENCES public.raw_material_batches(id) ON DELETE RESTRICT,
  opening_ledger_id bigint
    REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  raw_material_id uuid NOT NULL
    REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL
    REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  batch_number text,
  opening_quantity numeric(18,6) NOT NULL DEFAULT 0,
  prepared_batch_quantity numeric(18,6) NOT NULL DEFAULT 0,
  opening_receipt_count integer NOT NULL DEFAULT 0,
  candidate_cost numeric(18,6),
  candidate_source text,
  candidate_event_id text,
  candidate_reference text,
  candidate_at timestamptz,
  candidate_basis text,
  eligible boolean NOT NULL DEFAULT false,
  unresolved_reason text,
  PRIMARY KEY(run_id,batch_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_opening_cost_repair_plan_scope
  ON public.raw_opening_cost_repair_plan(run_id,branch_id,raw_material_id,warehouse_id);

ALTER TABLE public.raw_opening_cost_repair_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_opening_cost_repair_plan ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raw_opening_cost_repair_runs
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_opening_cost_repair_plan
  FROM PUBLIC,anon,authenticated;

GRANT ALL ON public.raw_opening_cost_repair_runs TO service_role,postgres;
GRANT ALL ON public.raw_opening_cost_repair_plan TO service_role,postgres;


CREATE OR REPLACE FUNCTION public.raw_opening_cost_prepare_repair(
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_summary jsonb;
BEGIN
  INSERT INTO public.raw_opening_cost_repair_runs(id,branch_id,status)
  VALUES(v_run,p_branch_id,'preparing');

  INSERT INTO public.raw_opening_cost_repair_plan(
    run_id,batch_id,opening_ledger_id,raw_material_id,branch_id,warehouse_id,
    batch_number,opening_quantity,prepared_batch_quantity,opening_receipt_count,
    candidate_cost,candidate_source,candidate_event_id,candidate_reference,
    candidate_at,candidate_basis,eligible,unresolved_reason
  )
  SELECT
    v_run,
    b.id,
    ol.opening_ledger_id,
    b.raw_material_id,
    b.branch_id,
    b.warehouse_id,
    b.batch_number,
    COALESCE(ol.opening_quantity,0),
    b.quantity,
    COALESCE(ol.receipt_count,0),
    c.unit_cost,
    c.source,
    c.event_id,
    c.reference_number,
    c.priced_at,
    CASE
      WHEN c.unit_cost IS NULL THEN NULL
      WHEN c.priced_at<=b.created_at THEN 'latest_at_or_before_opening'
      ELSE 'earliest_after_opening'
    END,
    (
      COALESCE(ol.receipt_count,0)=1
      AND COALESCE(ol.opening_quantity,0)>0
      AND COALESCE(c.unit_cost,0)>0
      AND c.priced_at<=b.created_at
    ),
    CASE
      WHEN COALESCE(ol.receipt_count,0)<>1 THEN 'OPENING_LEDGER_IDENTITY_AMBIGUOUS'
      WHEN COALESCE(ol.opening_quantity,0)<=0 THEN 'OPENING_QUANTITY_INVALID'
      WHEN COALESCE(c.unit_cost,0)<=0 THEN 'NO_AUTHORITATIVE_PRICE_EVENT'
      WHEN c.priced_at>b.created_at THEN 'FUTURE_PRICE_REQUIRES_REVIEW'
      ELSE NULL
    END
  FROM public.raw_material_batches b
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer receipt_count,
      min(il.id) opening_ledger_id,
      COALESCE(sum(il.quantity),0)::numeric(18,6) opening_quantity
    FROM public.inventory_ledger il
    WHERE il.raw_material_id=b.raw_material_id
      AND il.branch_id=b.branch_id
      AND il.warehouse_id=b.warehouse_id
      AND il.batch_number IS NOT DISTINCT FROM b.batch_number
      AND il.quantity>0
      AND il.reference_type='opening_inventory'
  ) ol ON true
  LEFT JOIN LATERAL (
    SELECT
      e.event_id,e.unit_cost,e.source,e.priced_at,e.reference_number
    FROM public._raw_cost_events_for_costing(b.raw_material_id,b.branch_id) e
    WHERE e.unit_cost>0
    ORDER BY
      CASE WHEN e.priced_at<=b.created_at THEN 0 ELSE 1 END,
      CASE WHEN e.priced_at<=b.created_at THEN e.priced_at END DESC NULLS LAST,
      CASE WHEN e.priced_at>b.created_at THEN e.priced_at END ASC NULLS LAST,
      e.source_rank,
      e.event_id
    LIMIT 1
  ) c ON true
  WHERE b.source_type='opening_inventory'
    AND COALESCE(b.unit_cost,0)=0
    AND (p_branch_id IS NULL OR b.branch_id=p_branch_id);

  SELECT jsonb_build_object(
    'run_id',v_run,
    'branch_id',p_branch_id,
    'opening_batches',count(*),
    'eligible_batches',count(*) FILTER (WHERE eligible),
    'unresolved_batches',count(*) FILTER (WHERE NOT eligible),
    'opening_quantity',round(COALESCE(sum(opening_quantity),0),4),
    'remaining_quantity',round(COALESCE(sum(GREATEST(prepared_batch_quantity,0)),0),4),
    'candidate_opening_value',round(COALESCE(sum(opening_quantity*candidate_cost) FILTER (WHERE eligible),0),2),
    'candidate_remaining_value',round(COALESCE(sum(GREATEST(prepared_batch_quantity,0)*candidate_cost) FILTER (WHERE eligible),0),2)
  )
  INTO v_summary
  FROM public.raw_opening_cost_repair_plan
  WHERE run_id=v_run;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='prepared',summary=v_summary,error_text=NULL
  WHERE id=v_run;

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_opening_cost_repair_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=v_run;
  RAISE;
END;
$function$;


CREATE OR REPLACE FUNCTION public.raw_opening_cost_apply_repair(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run public.raw_opening_cost_repair_runs%ROWTYPE;
  v_row public.raw_opening_cost_repair_plan%ROWTYPE;
  v_backfill jsonb;
  v_backfill_apply jsonb;
  v_backfill_run uuid;
  v_summary jsonb;
  v_applied integer:=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_opening_cost_repair_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','OPENING_COST_REPAIR_RUN_NOT_FOUND');
  END IF;

  IF v_run.status='applied' THEN
    RETURN jsonb_build_object(
      'success',true,'already_applied',true,'run_id',v_run.id,
      'fifo_backfill_run_id',v_run.fifo_backfill_run_id,'summary',v_run.summary
    );
  END IF;

  IF v_run.status<>'prepared' THEN
    RETURN jsonb_build_object(
      'success',false,'error','OPENING_COST_REPAIR_NOT_PREPARED','status',v_run.status
    );
  END IF;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='applying',error_text=NULL
  WHERE id=v_run.id;

  FOR v_row IN
    SELECT *
    FROM public.raw_opening_cost_repair_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY branch_id,raw_material_id,warehouse_id,batch_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );

    IF NOT EXISTS(
      SELECT 1
      FROM public.raw_material_batches b
      WHERE b.id=v_row.batch_id
        AND b.raw_material_id=v_row.raw_material_id
        AND b.branch_id=v_row.branch_id
        AND b.warehouse_id=v_row.warehouse_id
        AND b.batch_number IS NOT DISTINCT FROM v_row.batch_number
        AND b.source_type='opening_inventory'
        AND COALESCE(b.unit_cost,0)=0
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_BATCH_CHANGED batch=%',v_row.batch_id;
    END IF;

    IF NOT EXISTS(
      SELECT 1
      FROM public.inventory_ledger il
      WHERE il.id=v_row.opening_ledger_id
        AND il.raw_material_id=v_row.raw_material_id
        AND il.branch_id=v_row.branch_id
        AND il.warehouse_id=v_row.warehouse_id
        AND il.batch_number IS NOT DISTINCT FROM v_row.batch_number
        AND il.reference_type='opening_inventory'
        AND il.quantity=v_row.opening_quantity
        AND COALESCE(il.unit_cost,0)=0
        AND COALESCE(il.total_cost,0)=0
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_LEDGER_CHANGED ledger=%',v_row.opening_ledger_id;
    END IF;

    IF COALESCE(v_row.candidate_cost,0)<=0 OR v_row.candidate_at IS NULL THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_INVALID_CANDIDATE batch=%',v_row.batch_id;
    END IF;

    IF v_row.candidate_at > (
      SELECT b.created_at FROM public.raw_material_batches b WHERE b.id=v_row.batch_id
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_FUTURE_CANDIDATE batch=%',v_row.batch_id;
    END IF;

    UPDATE public.raw_material_batches
    SET unit_cost=v_row.candidate_cost
    WHERE id=v_row.batch_id;

    UPDATE public.inventory_ledger
    SET unit_cost=v_row.candidate_cost,
        total_cost=round(quantity*v_row.candidate_cost,2)
    WHERE id=v_row.opening_ledger_id;

    v_applied:=v_applied+1;
  END LOOP;

  -- Re-run the already-tested historical FIFO engine against the corrected
  -- opening receipt valuation. This changes valuation only; its own guards
  -- enforce stock-quantity invariants and supported reference types.
  v_backfill:=public.raw_fifo_prepare_backfill(v_run.branch_id);
  v_backfill_run:=NULLIF(v_backfill->>'run_id','')::uuid;

  IF v_backfill_run IS NULL THEN
    RAISE EXCEPTION 'OPENING_COST_REPAIR_FIFO_PREPARE_FAILED detail=%',v_backfill;
  END IF;

  v_backfill_apply:=public.raw_fifo_apply_backfill(v_backfill_run);
  IF COALESCE((v_backfill_apply->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OPENING_COST_REPAIR_FIFO_APPLY_FAILED detail=%',v_backfill_apply;
  END IF;

  v_summary:=COALESCE(v_run.summary,'{}'::jsonb)
    || jsonb_build_object(
      'success',true,
      'applied_batches',v_applied,
      'fifo_backfill_run_id',v_backfill_run,
      'fifo_backfill_summary',v_backfill
    );

  UPDATE public.raw_opening_cost_repair_runs
  SET status='applied',
      fifo_backfill_run_id=v_backfill_run,
      summary=v_summary,
      applied_at=now(),
      error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object(
    'success',true,
    'run_id',v_run.id,
    'applied_batches',v_applied,
    'fifo_backfill_run_id',v_backfill_run,
    'unresolved_batches',COALESCE((v_run.summary->>'unresolved_batches')::integer,0),
    'fifo_backfill_summary',v_backfill
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_opening_cost_repair_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$;


CREATE OR REPLACE FUNCTION public.raw_opening_cost_reverse_repair(
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run public.raw_opening_cost_repair_runs%ROWTYPE;
  v_row public.raw_opening_cost_repair_plan%ROWTYPE;
  v_reverse jsonb;
  v_scope record;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_opening_cost_repair_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','OPENING_COST_REPAIR_RUN_NOT_FOUND');
  END IF;

  IF v_run.status='reversed' THEN
    RETURN jsonb_build_object('success',true,'already_reversed',true,'run_id',v_run.id);
  END IF;

  IF v_run.status<>'applied' OR v_run.fifo_backfill_run_id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,'error','OPENING_COST_REPAIR_NOT_APPLIED','status',v_run.status
    );
  END IF;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='reversing',error_text=NULL
  WHERE id=v_run.id;

  v_reverse:=public.raw_fifo_reverse_backfill(v_run.fifo_backfill_run_id);
  IF COALESCE((v_reverse->>'success')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OPENING_COST_REPAIR_FIFO_REVERSE_FAILED detail=%',v_reverse;
  END IF;

  FOR v_row IN
    SELECT *
    FROM public.raw_opening_cost_repair_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY branch_id,raw_material_id,warehouse_id,batch_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );

    IF NOT EXISTS(
      SELECT 1 FROM public.raw_material_batches b
      WHERE b.id=v_row.batch_id
        AND abs(COALESCE(b.unit_cost,0)-v_row.candidate_cost)<=0.000001
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_REVERSE_BATCH_CHANGED batch=%',v_row.batch_id;
    END IF;

    IF NOT EXISTS(
      SELECT 1 FROM public.inventory_ledger il
      WHERE il.id=v_row.opening_ledger_id
        AND abs(COALESCE(il.unit_cost,0)-v_row.candidate_cost)<=0.000001
    ) THEN
      RAISE EXCEPTION 'OPENING_COST_REPAIR_REVERSE_LEDGER_CHANGED ledger=%',v_row.opening_ledger_id;
    END IF;

    UPDATE public.raw_material_batches
    SET unit_cost=0
    WHERE id=v_row.batch_id;

    UPDATE public.inventory_ledger
    SET unit_cost=0,total_cost=0
    WHERE id=v_row.opening_ledger_id;
  END LOOP;

  FOR v_scope IN
    SELECT DISTINCT raw_material_id,branch_id
    FROM public.raw_opening_cost_repair_plan
    WHERE run_id=v_run.id AND eligible
  LOOP
    INSERT INTO public.raw_material_inventory(
      raw_material_id,branch_id,quantity,avg_cost
    )
    SELECT
      v_scope.raw_material_id,
      v_scope.branch_id,
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
    WHERE b.raw_material_id=v_scope.raw_material_id
      AND b.branch_id=v_scope.branch_id
    ON CONFLICT(raw_material_id,branch_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,
        avg_cost=EXCLUDED.avg_cost,
        updated_at=now();
  END LOOP;

  UPDATE public.raw_opening_cost_repair_runs
  SET status='reversed',reversed_at=now(),error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object(
    'success',true,'run_id',v_run.id,
    'fifo_backfill_run_id',v_run.fifo_backfill_run_id,
    'fifo_reverse',v_reverse
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_opening_cost_repair_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$;


REVOKE ALL ON FUNCTION public.raw_opening_cost_prepare_repair(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.raw_opening_cost_apply_repair(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.raw_opening_cost_reverse_repair(uuid)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.raw_opening_cost_prepare_repair(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.raw_opening_cost_apply_repair(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.raw_opening_cost_reverse_repair(uuid)
  TO service_role,postgres;

COMMENT ON FUNCTION public.raw_opening_cost_prepare_repair(uuid) IS
  'Dry-run plan for zero-cost raw opening inventory valuation. No stock or valuation mutation.';
COMMENT ON FUNCTION public.raw_opening_cost_apply_repair(uuid) IS
  'Applies authoritative opening valuation candidates and atomically replays existing historical FIFO valuation.';
COMMENT ON FUNCTION public.raw_opening_cost_reverse_repair(uuid) IS
  'Guarded reversal: reverses generated FIFO backfill first, then restores repair-owned opening valuations.';

COMMIT;
