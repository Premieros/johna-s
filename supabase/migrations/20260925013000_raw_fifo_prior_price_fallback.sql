-- Audited prior-price fallback for historical zero-cost raw consumption.
-- Uses only positive authoritative price events at or before consumption time.
-- Open FIFO debt receives a provisional basis that future receipts replace by delta only.
-- No physical stock quantity is changed by prepare/apply/reverse.
BEGIN;

CREATE TABLE IF NOT EXISTS public.raw_fifo_price_fallback_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('preparing','prepared','applying','applied','reversing','reversed','failed')),
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  reversed_at timestamptz,
  error_text text
);

CREATE TABLE IF NOT EXISTS public.raw_fifo_price_fallback_plan (
  run_id uuid NOT NULL REFERENCES public.raw_fifo_price_fallback_runs(id) ON DELETE CASCADE,
  source_ledger_id bigint NOT NULL REFERENCES public.inventory_ledger(id) ON DELETE CASCADE,
  debt_id uuid REFERENCES public.raw_fifo_debts(id) ON DELETE SET NULL,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  reference_type text,
  reference_id uuid,
  reference_number text,
  source_created_at timestamptz NOT NULL,
  source_quantity numeric(18,6) NOT NULL CHECK (source_quantity > 0),
  open_debt_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (open_debt_quantity >= 0),
  candidate_unit_cost numeric(18,6),
  candidate_source text,
  candidate_event_id text,
  candidate_at timestamptz,
  target_cost numeric(18,6),
  eligible boolean NOT NULL DEFAULT false,
  unresolved_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,source_ledger_id)
);

CREATE TABLE IF NOT EXISTS public.raw_fifo_debt_price_estimates (
  debt_id uuid PRIMARY KEY REFERENCES public.raw_fifo_debts(id) ON DELETE CASCADE,
  source_ledger_id bigint NOT NULL UNIQUE REFERENCES public.inventory_ledger(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.raw_fifo_price_fallback_runs(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  estimated_unit_cost numeric(18,6) NOT NULL CHECK (estimated_unit_cost > 0),
  original_estimated_quantity numeric(18,6) NOT NULL CHECK (original_estimated_quantity > 0),
  remaining_estimated_quantity numeric(18,6) NOT NULL CHECK (remaining_estimated_quantity >= 0),
  replaced_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (replaced_quantity >= 0),
  zero_cost_finalized_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (zero_cost_finalized_quantity >= 0),
  candidate_source text NOT NULL,
  candidate_event_id text NOT NULL,
  candidate_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    remaining_estimated_quantity + replaced_quantity + zero_cost_finalized_quantity
    <= original_estimated_quantity + 0.000001
  )
);

CREATE INDEX IF NOT EXISTS idx_raw_fifo_price_fallback_plan_branch
  ON public.raw_fifo_price_fallback_plan(run_id,branch_id,raw_material_id,source_ledger_id);
CREATE INDEX IF NOT EXISTS idx_raw_fifo_debt_price_estimates_run
  ON public.raw_fifo_debt_price_estimates(run_id,branch_id,raw_material_id);

ALTER TABLE public.raw_fifo_price_fallback_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_price_fallback_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_debt_price_estimates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raw_fifo_price_fallback_runs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_price_fallback_plan FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_debt_price_estimates FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.raw_fifo_price_fallback_runs TO service_role,postgres;
GRANT ALL ON public.raw_fifo_price_fallback_plan TO service_role,postgres;
GRANT ALL ON public.raw_fifo_debt_price_estimates TO service_role,postgres;

CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_prepare(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_summary jsonb;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id=p_branch_id
  ) THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_BRANCH_NOT_FOUND');
  END IF;

  INSERT INTO public.raw_fifo_price_fallback_runs(id,branch_id,status)
  VALUES(v_run,p_branch_id,'preparing');

  INSERT INTO public.raw_fifo_price_fallback_plan(
    run_id,source_ledger_id,debt_id,raw_material_id,branch_id,warehouse_id,
    reference_type,reference_id,reference_number,source_created_at,
    source_quantity,open_debt_quantity,
    candidate_unit_cost,candidate_source,candidate_event_id,candidate_at,
    target_cost,eligible,unresolved_reason
  )
  SELECT
    v_run,
    il.id,
    d.id,
    il.raw_material_id,
    il.branch_id,
    il.warehouse_id,
    il.reference_type,
    il.reference_id,
    il.reference_number,
    il.created_at,
    abs(il.quantity)::numeric(18,6),
    GREATEST(COALESCE(d.debt_quantity-d.settled_quantity,0),0)::numeric(18,6),
    e.unit_cost,
    e.source,
    e.event_id,
    e.priced_at,
    CASE WHEN e.unit_cost>0 THEN round(abs(il.quantity)*e.unit_cost,6) END,
    (
      e.unit_cost>0
      AND e.priced_at<=il.created_at
      AND il.reference_id IS NOT NULL
      AND COALESCE(il.reference_type,'') IN ('sale','kitchen_send','production','purchase_return')
      AND NOT (
        COALESCE(d.debt_quantity-d.settled_quantity,0)>0
        AND EXISTS (
          SELECT 1
          FROM public.raw_fifo_debt_price_estimates x
          WHERE x.debt_id=d.id
            AND x.remaining_estimated_quantity>0
        )
      )
    ),
    CASE
      WHEN e.unit_cost IS NULL THEN 'NO_PRIOR_AUTHORITATIVE_PRICE'
      WHEN e.priced_at>il.created_at THEN 'FUTURE_PRICE_REFUSED'
      WHEN il.reference_id IS NULL THEN 'REFERENCE_ID_MISSING'
      WHEN COALESCE(il.reference_type,'') NOT IN ('sale','kitchen_send','production','purchase_return')
        THEN 'REFERENCE_TYPE_UNSUPPORTED'
      WHEN COALESCE(d.debt_quantity-d.settled_quantity,0)>0
       AND EXISTS (
         SELECT 1
         FROM public.raw_fifo_debt_price_estimates x
         WHERE x.debt_id=d.id
           AND x.remaining_estimated_quantity>0
       ) THEN 'ACTIVE_DEBT_ESTIMATE_EXISTS'
      ELSE NULL
    END
  FROM public.inventory_ledger il
  LEFT JOIN public.raw_fifo_debts d
    ON d.source_ledger_id=il.id
  LEFT JOIN LATERAL (
    SELECT ce.event_id,ce.unit_cost,ce.source,ce.priced_at
    FROM public._raw_cost_events_for_costing(il.raw_material_id,il.branch_id) ce
    WHERE ce.unit_cost>0
      AND ce.priced_at<=il.created_at
    ORDER BY ce.priced_at DESC,ce.source_rank,ce.event_id
    LIMIT 1
  ) e ON true
  WHERE il.branch_id=p_branch_id
    AND il.raw_material_id IS NOT NULL
    AND il.warehouse_id IS NOT NULL
    AND il.quantity<0
    AND abs(COALESCE(il.total_cost,0))<=0.005;

  SELECT jsonb_build_object(
    'success',true,
    'run_id',v_run,
    'branch_id',p_branch_id,
    'zero_cost_rows',count(*),
    'eligible_rows',count(*) FILTER (WHERE eligible),
    'unresolved_rows',count(*) FILTER (WHERE NOT eligible),
    'eligible_materials',count(DISTINCT raw_material_id) FILTER (WHERE eligible),
    'provisional_debt_rows',count(*) FILTER (WHERE eligible AND open_debt_quantity>0),
    'provisional_debt_quantity',round(COALESCE(sum(open_debt_quantity) FILTER (WHERE eligible),0),4),
    'target_cost_value',round(COALESCE(sum(target_cost) FILTER (WHERE eligible),0),2)
  )
  INTO v_summary
  FROM public.raw_fifo_price_fallback_plan
  WHERE run_id=v_run;

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='prepared',summary=v_summary,error_text=NULL
  WHERE id=v_run;

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_price_fallback_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=v_run;
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_apply(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run public.raw_fifo_price_fallback_runs%ROWTYPE;
  v_row public.raw_fifo_price_fallback_plan%ROWTYPE;
  v_source public.inventory_ledger%ROWTYPE;
  v_debt public.raw_fifo_debts%ROWTYPE;
  v_res jsonb;
  v_applied integer:=0;
  v_provisional integer:=0;
  v_value numeric(18,6):=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_price_fallback_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_RUN_NOT_FOUND');
  END IF;
  IF v_run.status='applied' THEN
    RETURN jsonb_build_object('success',true,'already_applied',true,'run_id',v_run.id,'summary',v_run.summary);
  END IF;
  IF v_run.status<>'prepared' THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_NOT_PREPARED','status',v_run.status);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fifo-price-fallback:'||v_run.branch_id::text,0));

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='applying',error_text=NULL
  WHERE id=v_run.id;

  FOR v_row IN
    SELECT *
    FROM public.raw_fifo_price_fallback_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY source_created_at,source_ledger_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.raw_material_id::text||':'||v_row.branch_id::text,0)
    );

    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_row.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL
       OR v_source.branch_id IS DISTINCT FROM v_row.branch_id
       OR v_source.raw_material_id IS DISTINCT FROM v_row.raw_material_id
       OR v_source.warehouse_id IS DISTINCT FROM v_row.warehouse_id
       OR v_source.reference_type IS DISTINCT FROM v_row.reference_type
       OR v_source.reference_id IS DISTINCT FROM v_row.reference_id
       OR v_source.quantity>=0
       OR abs(abs(v_source.quantity)-v_row.source_quantity)>0.000001
       OR abs(COALESCE(v_source.total_cost,0))>0.005 THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_SOURCE_CHANGED ledger=%',v_row.source_ledger_id;
    END IF;

    IF COALESCE(v_row.candidate_unit_cost,0)<=0
       OR v_row.candidate_at IS NULL
       OR v_row.candidate_at>v_source.created_at
       OR COALESCE(v_row.target_cost,0)<=0 THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_CANDIDATE_INVALID ledger=%',v_row.source_ledger_id;
    END IF;

    IF v_row.open_debt_quantity>0 THEN
      SELECT * INTO v_debt
      FROM public.raw_fifo_debts
      WHERE id=v_row.debt_id
      FOR UPDATE;

      IF v_debt.id IS NULL
         OR v_debt.source_ledger_id<>v_row.source_ledger_id
         OR abs((v_debt.debt_quantity-v_debt.settled_quantity)-v_row.open_debt_quantity)>0.000001 THEN
        RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_DEBT_CHANGED ledger=%',v_row.source_ledger_id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.raw_fifo_debt_price_estimates e
        WHERE e.debt_id=v_debt.id
      ) THEN
        RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_ESTIMATE_EXISTS ledger=%',v_row.source_ledger_id;
      END IF;
    END IF;

    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,
      v_row.reference_id,
      v_row.branch_id,
      v_row.warehouse_id,
      'raw_material',
      v_row.raw_material_id,
      v_row.target_cost,
      0
    );

    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REFERENCE_FAILED ledger=% detail=%',
        v_row.source_ledger_id,v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=-v_row.target_cost,
        unit_cost=v_row.target_cost/v_row.source_quantity
    WHERE id=v_row.source_ledger_id;

    IF v_row.open_debt_quantity>0 THEN
      INSERT INTO public.raw_fifo_debt_price_estimates(
        debt_id,source_ledger_id,run_id,branch_id,raw_material_id,
        estimated_unit_cost,original_estimated_quantity,remaining_estimated_quantity,
        candidate_source,candidate_event_id,candidate_at
      ) VALUES (
        v_row.debt_id,v_row.source_ledger_id,v_run.id,v_row.branch_id,v_row.raw_material_id,
        v_row.candidate_unit_cost,v_row.open_debt_quantity,v_row.open_debt_quantity,
        v_row.candidate_source,v_row.candidate_event_id,v_row.candidate_at
      );
      v_provisional:=v_provisional+1;
    END IF;

    v_applied:=v_applied+1;
    v_value:=v_value+v_row.target_cost;
  END LOOP;

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='applied',
      applied_at=now(),
      summary=COALESCE(summary,'{}'::jsonb)||jsonb_build_object(
        'applied_rows',v_applied,
        'provisional_rows',v_provisional,
        'applied_value',round(v_value,2)
      ),
      error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object(
    'success',true,'run_id',v_run.id,
    'applied_rows',v_applied,
    'provisional_rows',v_provisional,
    'applied_value',round(v_value,2)
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_price_fallback_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.raw_fifo_price_fallback_reverse(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run public.raw_fifo_price_fallback_runs%ROWTYPE;
  v_row public.raw_fifo_price_fallback_plan%ROWTYPE;
  v_source public.inventory_ledger%ROWTYPE;
  v_res jsonb;
  v_reversed integer:=0;
BEGIN
  SELECT * INTO v_run
  FROM public.raw_fifo_price_fallback_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_RUN_NOT_FOUND');
  END IF;
  IF v_run.status='reversed' THEN
    RETURN jsonb_build_object('success',true,'already_reversed',true,'run_id',v_run.id);
  END IF;
  IF v_run.status<>'applied' THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRICE_FALLBACK_NOT_APPLIED','status',v_run.status);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.raw_fifo_debt_price_estimates e
    WHERE e.run_id=v_run.id
      AND (
        abs(e.remaining_estimated_quantity-e.original_estimated_quantity)>0.000001
        OR e.replaced_quantity>0.000001
        OR e.zero_cost_finalized_quantity>0.000001
      )
  ) THEN
    RETURN jsonb_build_object(
      'success',false,'error','FIFO_PRICE_FALLBACK_ESTIMATE_CONSUMED','run_id',v_run.id
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fifo-price-fallback:'||v_run.branch_id::text,0));

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='reversing',error_text=NULL
  WHERE id=v_run.id;

  FOR v_row IN
    SELECT *
    FROM public.raw_fifo_price_fallback_plan
    WHERE run_id=v_run.id AND eligible
    ORDER BY source_created_at DESC,source_ledger_id DESC
  LOOP
    SELECT * INTO v_source
    FROM public.inventory_ledger
    WHERE id=v_row.source_ledger_id
    FOR UPDATE;

    IF v_source.id IS NULL
       OR v_source.quantity>=0
       OR abs(COALESCE(v_source.total_cost,0)+v_row.target_cost)>0.005 THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REVERSE_SOURCE_CHANGED ledger=%',v_row.source_ledger_id;
    END IF;

    v_res:=public._fifo_adjust_reference_delta(
      v_row.reference_type,
      v_row.reference_id,
      v_row.branch_id,
      v_row.warehouse_id,
      'raw_material',
      v_row.raw_material_id,
      -v_row.target_cost,
      0
    );
    IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIFO_PRICE_FALLBACK_REVERSE_REFERENCE_FAILED ledger=% detail=%',
        v_row.source_ledger_id,v_res;
    END IF;

    UPDATE public.inventory_ledger
    SET total_cost=0,unit_cost=0
    WHERE id=v_row.source_ledger_id;

    v_reversed:=v_reversed+1;
  END LOOP;

  DELETE FROM public.raw_fifo_debt_price_estimates
  WHERE run_id=v_run.id;

  UPDATE public.raw_fifo_price_fallback_runs
  SET status='reversed',reversed_at=now(),error_text=NULL
  WHERE id=v_run.id;

  RETURN jsonb_build_object('success',true,'run_id',v_run.id,'reversed_rows',v_reversed);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.raw_fifo_price_fallback_runs
  SET status='failed',error_text=SQLERRM
  WHERE id=p_run_id;
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(
  p_receipt_ledger_id bigint,
  p_receipt_batch_id uuid,
  p_run_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
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

    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_take,0)
    WHERE id=v_batch.id;

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

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'cost_adjustment',v_total_adjustment,
    'remaining_receipt_quantity',v_available
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.raw_fifo_price_fallback_prepare(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.raw_fifo_price_fallback_apply(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.raw_fifo_price_fallback_reverse(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._raw_fifo_settle_receipt(bigint,uuid,uuid)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.raw_fifo_price_fallback_prepare(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.raw_fifo_price_fallback_apply(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.raw_fifo_price_fallback_reverse(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public._raw_fifo_settle_receipt(bigint,uuid,uuid)
  TO service_role,postgres;

COMMENT ON FUNCTION public.raw_fifo_price_fallback_prepare(uuid) IS
  'Dry-run plan for zero-cost raw consumption using only authoritative price events at or before consumption.';
COMMENT ON FUNCTION public.raw_fifo_price_fallback_apply(uuid) IS
  'Applies audited prior-price valuation without changing stock quantity; open debt is tracked provisionally.';
COMMENT ON FUNCTION public.raw_fifo_price_fallback_reverse(uuid) IS
  'Reverses an untouched fallback run; refuses after any provisional estimate has been consumed by later receipts.';

COMMIT;
