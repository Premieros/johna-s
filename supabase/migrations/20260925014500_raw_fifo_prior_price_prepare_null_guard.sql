-- Follow-up: make unresolved no-price rows explicit false instead of NULL.
-- Required because Production contains zero-cost rows with no prior authoritative price.
BEGIN;

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
    COALESCE((
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
    ),false),
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

COMMIT;
