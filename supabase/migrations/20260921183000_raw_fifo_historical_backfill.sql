-- Historical FIFO replay/backfill infrastructure.
-- IMPORTANT: this migration defines prepare/apply tools only.
-- It does NOT run a historical backfill automatically.
--
-- Safety model:
--   * prepare builds an immutable auditable plan from inventory_ledger;
--   * apply requires the plan to still match the latest raw ledger id;
--   * apply takes the same raw/branch advisory locks used by _raw_add/_raw_remove_fifo;
--   * net stock quantity is preserved; only per-batch residual allocation and valuation change;
--   * supported changed negative references are sale, kitchen_send, production, purchase_return;
--   * any unknown changed reference blocks apply rather than being guessed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  cutoff_ledger_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing','prepared','applying','applied','cancelled','failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  error_text text
);

CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_plan (
  run_id uuid NOT NULL
    REFERENCES public.raw_fifo_backfill_runs(id) ON DELETE CASCADE,
  consumption_ledger_id bigint NOT NULL
    REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  raw_material_id uuid NOT NULL
    REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL
    REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  reference_type text,
  reference_id uuid,
  reference_number text,
  entry_type text NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  current_cost numeric(18,6) NOT NULL DEFAULT 0 CHECK (current_cost >= 0),
  target_cost numeric(18,6) NOT NULL DEFAULT 0 CHECK (target_cost >= 0),
  debt_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (debt_quantity >= 0),
  unresolved_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (unresolved_quantity >= 0),
  source_created_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,consumption_ledger_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_fifo_backfill_plan_changed
  ON public.raw_fifo_backfill_plan(run_id,branch_id,reference_type)
  WHERE abs(target_cost-current_cost) > 0.005;

CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_allocations (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL
    REFERENCES public.raw_fifo_backfill_runs(id) ON DELETE CASCADE,
  consumption_ledger_id bigint NOT NULL
    REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  receipt_ledger_id bigint NOT NULL
    REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  allocation_type text NOT NULL
    CHECK (allocation_type IN ('fifo','debt_settlement')),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(18,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(18,6) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  UNIQUE(run_id,consumption_ledger_id,receipt_ledger_id,allocation_type)
);

CREATE TABLE IF NOT EXISTS public.raw_fifo_backfill_batch_plan (
  run_id uuid NOT NULL
    REFERENCES public.raw_fifo_backfill_runs(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL
    REFERENCES public.raw_material_batches(id) ON DELETE RESTRICT,
  raw_material_id uuid NOT NULL
    REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL
    REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  current_quantity numeric(18,6) NOT NULL,
  target_quantity numeric(18,6) NOT NULL,
  PRIMARY KEY(run_id,batch_id)
);

CREATE TABLE IF NOT EXISTS public.raw_fifo_stock_adjustments (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  exact_delta numeric(18,6) NOT NULL DEFAULT 0,
  posted_delta numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(branch_id,reference_type,reference_id)
);

ALTER TABLE public.raw_fifo_backfill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_backfill_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_backfill_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_backfill_batch_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_stock_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raw_fifo_backfill_runs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_backfill_plan FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_backfill_allocations FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_backfill_batch_plan FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.raw_fifo_stock_adjustments FROM PUBLIC,anon,authenticated;

GRANT ALL ON public.raw_fifo_backfill_runs TO service_role,postgres;
GRANT ALL ON public.raw_fifo_backfill_plan TO service_role,postgres;
GRANT ALL ON public.raw_fifo_backfill_allocations TO service_role,postgres;
GRANT ALL ON public.raw_fifo_backfill_batch_plan TO service_role,postgres;
GRANT ALL ON public.raw_fifo_stock_adjustments TO service_role,postgres;

CREATE OR REPLACE FUNCTION public._fifo_adjust_stock_variance_delta(
  p_branch_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_entry_date date,
  p_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_row public.raw_fifo_stock_adjustments%ROWTYPE;
  v_target numeric(18,2);
  v_entry_id uuid;
  v_entry_no text;
  v_inventory_account uuid;
  v_variance_account uuid;
  v_inventory_line bigint;
  v_variance_line bigint;
BEGIN
  IF p_branch_id IS NULL OR p_reference_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'posted_delta',0);
  END IF;

  INSERT INTO public.raw_fifo_stock_adjustments(
    branch_id,reference_type,reference_id,exact_delta,posted_delta
  ) VALUES (
    p_branch_id,p_reference_type,p_reference_id,p_delta,0
  )
  ON CONFLICT(branch_id,reference_type,reference_id) DO UPDATE
  SET exact_delta=public.raw_fifo_stock_adjustments.exact_delta+EXCLUDED.exact_delta,
      updated_at=now()
  RETURNING * INTO v_row;

  v_target:=round(v_row.exact_delta,2);
  IF v_target=v_row.posted_delta THEN
    RETURN jsonb_build_object('success',true,'posted_delta',v_target);
  END IF;

  SELECT account_id INTO v_inventory_account
  FROM public.account_mappings
  WHERE branch_id=p_branch_id AND semantic_key='inventory_rm';

  SELECT account_id INTO v_variance_account
  FROM public.account_mappings
  WHERE branch_id=p_branch_id AND semantic_key='stock_variance';

  IF v_inventory_account IS NULL OR v_variance_account IS NULL THEN
    RAISE EXCEPTION 'FIFO_STOCK_ACCOUNT_MAPPING_MISSING branch=%',p_branch_id;
  END IF;

  v_entry_id:=v_row.journal_entry_id;
  IF v_entry_id IS NULL THEN
    v_entry_no:=(public.next_document_number('journal')->>'number')::text;
    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_entry_no,p_branch_id,COALESCE(p_entry_date,CURRENT_DATE),
      'fifo_stock_reconcile',p_reference_id,p_reference_number,
      'FIFO stock valuation reconciliation '||COALESCE(p_reference_number,p_reference_id::text),
      auth.uid()
    )
    RETURNING id INTO v_entry_id;

    UPDATE public.raw_fifo_stock_adjustments
    SET journal_entry_id=v_entry_id
    WHERE branch_id=p_branch_id
      AND reference_type=p_reference_type
      AND reference_id=p_reference_id;
  END IF;

  SELECT id INTO v_inventory_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_inventory_account
  ORDER BY id LIMIT 1 FOR UPDATE;

  IF v_inventory_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_inventory_account,
      GREATEST(-v_target,0),GREATEST(v_target,0),
      'FIFO raw inventory valuation'
    )
    RETURNING id INTO v_inventory_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(-v_target,0),
        credit=GREATEST(v_target,0)
    WHERE id=v_inventory_line;
  END IF;

  SELECT id INTO v_variance_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_variance_account
  ORDER BY id LIMIT 1 FOR UPDATE;

  IF v_variance_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_variance_account,
      GREATEST(v_target,0),GREATEST(-v_target,0),
      'FIFO raw inventory valuation offset'
    )
    RETURNING id INTO v_variance_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(v_target,0),
        credit=GREATEST(-v_target,0)
    WHERE id=v_variance_line;
  END IF;

  UPDATE public.raw_fifo_stock_adjustments
  SET posted_delta=v_target,updated_at=now()
  WHERE branch_id=p_branch_id
    AND reference_type=p_reference_type
    AND reference_id=p_reference_id;

  RETURN jsonb_build_object(
    'success',true,
    'posted_delta',v_target,
    'journal_entry_id',v_entry_id
  );
END;
$function$;

-- Extend reference reconciliation with purchase-return valuation support.
CREATE OR REPLACE FUNCTION public._fifo_adjust_reference_delta(
  p_reference_type text,
  p_reference_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_delta numeric,
  p_depth integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_ref_no text;
  v_entry_date date;
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
    RETURN public._fifo_adjust_kitchen_effect_delta(
      p_reference_id,p_target_type,p_target_id,p_delta
    );
  ELSIF p_reference_type='production' THEN
    RETURN public._fifo_adjust_production_delta(
      p_reference_id,p_delta,p_depth+1
    );
  ELSIF p_reference_type='purchase_return' THEN
    SELECT invoice_number,(created_at AT TIME ZONE 'Africa/Cairo')::date
    INTO v_ref_no,v_entry_date
    FROM public.purchases
    WHERE id=p_reference_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.raw_fifo_prepare_backfill(
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
DECLARE
  v_run uuid:=gen_random_uuid();
  v_cutoff bigint;
  e record;
  d record;
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

      FOR d IN
        SELECT *
        FROM rf_debts
        WHERE raw_material_id=e.raw_material_id
          AND branch_id=e.branch_id
          AND warehouse_id=e.warehouse_id
          AND remaining_qty>0
        ORDER BY event_at,id
      LOOP
        EXIT WHEN v_remaining<=0;
        v_take:=LEAST(v_remaining,d.remaining_qty);

        UPDATE public.raw_fifo_backfill_plan
        SET target_cost=target_cost+v_take*COALESCE(e.unit_cost,0),
            unresolved_quantity=GREATEST(unresolved_quantity-v_take,0)
        WHERE run_id=v_run
          AND consumption_ledger_id=d.consumption_ledger_id;

        INSERT INTO public.raw_fifo_backfill_allocations(
          run_id,consumption_ledger_id,receipt_ledger_id,
          allocation_type,quantity,unit_cost,total_cost
        ) VALUES (
          v_run,d.consumption_ledger_id,e.id,
          'debt_settlement',v_take,COALESCE(e.unit_cost,0),
          v_take*COALESCE(e.unit_cost,0)
        );

        UPDATE rf_debts
        SET remaining_qty=remaining_qty-v_take
        WHERE id=d.id;

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
          CASE WHEN e.batch_number LIKE 'OV-%' THEN v_batch_id ELSE NULL END,
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
      'sale','kitchen_send','production','purchase_return'
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
      CASE
        WHEN b.quantity<0 AND b.batch_number LIKE 'OV-%' THEN
          -COALESCE((
            SELECT sum(d.remaining_qty)
            FROM rf_debts d WHERE d.oversold_batch_id=b.id
          ),0)
        ELSE COALESCE((
          SELECT sum(l.available_qty)
          FROM rf_lots l WHERE l.batch_id=b.id
        ),0)
      END
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
$function$;

CREATE OR REPLACE FUNCTION public.raw_fifo_apply_backfill(
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
  v_changed integer;
  v_batch_changed integer;
  v_row record;
  v_debt_id uuid;
  v_batch_id uuid;
  v_res jsonb;
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
        'sale','kitchen_send','production','purchase_return'
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

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at
    ) VALUES (
      v_row.consumption_ledger_id,v_row.raw_material_id,v_row.branch_id,v_row.warehouse_id,
      CASE WHEN v_row.batch_number LIKE 'OV-%' THEN v_batch_id ELSE NULL END,
      v_row.reference_type,v_row.reference_id,v_row.reference_number,
      v_row.debt_quantity,v_row.debt_quantity-v_row.unresolved_quantity,v_row.source_created_at
    )
    ON CONFLICT(source_ledger_id) DO UPDATE
    SET debt_quantity=EXCLUDED.debt_quantity,
        settled_quantity=EXCLUDED.settled_quantity,
        updated_at=now()
    RETURNING id INTO v_debt_id;

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
    ON CONFLICT(debt_id,receipt_ledger_id) DO UPDATE
    SET quantity=EXCLUDED.quantity,
        unit_cost=EXCLUDED.unit_cost,
        total_cost=EXCLUDED.total_cost,
        run_id=EXCLUDED.run_id,
        reconciliation_status='applied',
        reconciliation_error=NULL;
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
$function$;

REVOKE ALL ON FUNCTION public._fifo_adjust_stock_variance_delta(uuid,text,uuid,text,date,numeric)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.raw_fifo_prepare_backfill(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.raw_fifo_apply_backfill(uuid)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public._fifo_adjust_stock_variance_delta(uuid,text,uuid,text,date,numeric)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.raw_fifo_prepare_backfill(uuid)
  TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.raw_fifo_apply_backfill(uuid)
  TO service_role,postgres;

COMMIT;
