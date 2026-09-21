-- FIFO negative raw-material cost reconciliation.
-- Future/live contract:
--   * raw stock may stay negative for POS sale/kitchen/auto-production;
--   * the oversold quantity is recorded as a FIFO debt linked to its source ledger row;
--   * every later positive raw receipt settles the oldest debt first;
--   * settlement uses the actual incoming FIFO unit cost;
--   * net stock quantity is unchanged by settlement (negative debt batch moves toward
--     zero while the same quantity is removed from the incoming positive batch);
--   * valuation delta propagates to direct sales, kitchen events and manufactured
--     inventory units without replaying stock quantity movements;
--   * accounting corrections are posted in a separate auditable journal entry.
--
-- Historical backfill is deliberately implemented separately and must be dry-run
-- before Production application.

BEGIN;

CREATE TABLE IF NOT EXISTS public.raw_fifo_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ledger_id bigint NOT NULL UNIQUE
    REFERENCES public.inventory_ledger(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL
    REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL
    REFERENCES public.branches(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  oversold_batch_id uuid
    REFERENCES public.raw_material_batches(id) ON DELETE SET NULL,
  reference_type text,
  reference_id uuid,
  reference_number text,
  debt_quantity numeric(18,6) NOT NULL CHECK (debt_quantity > 0),
  settled_quantity numeric(18,6) NOT NULL DEFAULT 0
    CHECK (settled_quantity >= 0 AND settled_quantity <= debt_quantity),
  source_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_fifo_debts_open
  ON public.raw_fifo_debts(
    raw_material_id, branch_id, warehouse_id, source_created_at, source_ledger_id
  )
  WHERE settled_quantity < debt_quantity;

CREATE TABLE IF NOT EXISTS public.raw_fifo_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL
    REFERENCES public.raw_fifo_debts(id) ON DELETE CASCADE,
  receipt_ledger_id bigint NOT NULL
    REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  receipt_batch_id uuid
    REFERENCES public.raw_material_batches(id) ON DELETE SET NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(18,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(18,6) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  reconciliation_status text NOT NULL DEFAULT 'applied'
    CHECK (reconciliation_status IN ('applied','pending','error')),
  reconciliation_error text,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(debt_id, receipt_ledger_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_fifo_settlements_receipt
  ON public.raw_fifo_settlements(receipt_ledger_id);

CREATE TABLE IF NOT EXISTS public.raw_fifo_sale_cogs_adjustments (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  exact_delta numeric(18,6) NOT NULL DEFAULT 0,
  posted_delta numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.raw_fifo_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_fifo_sale_cogs_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.raw_fifo_debts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raw_fifo_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.raw_fifo_sale_cogs_adjustments FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.raw_fifo_debts TO service_role, postgres;
GRANT ALL ON public.raw_fifo_settlements TO service_role, postgres;
GRANT ALL ON public.raw_fifo_sale_cogs_adjustments TO service_role, postgres;

CREATE OR REPLACE FUNCTION public._fifo_adjust_sale_cogs_delta(
  p_sale_id uuid,
  p_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_row public.raw_fifo_sale_cogs_adjustments%ROWTYPE;
  v_target_posted numeric(18,2);
  v_post_delta numeric(18,2);
  v_entry_id uuid;
  v_entry_number text;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_cogs_line bigint;
  v_inventory_line bigint;
  v_base_cogs numeric(18,6):=0;
BEGIN
  IF p_sale_id IS NULL OR COALESCE(p_delta,0) = 0 THEN
    RETURN jsonb_build_object('success',true,'posted_delta',0);
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id=p_sale_id
  FOR SHARE;

  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_SALE_NOT_FOUND');
  END IF;

  SELECT COALESCE(sum(jl.debit-jl.credit),0)
  INTO v_base_cogs
  FROM public.journal_entries je
  JOIN public.account_mappings am
    ON am.branch_id=v_sale.branch_id AND am.semantic_key='cogs'
  JOIN public.journal_entry_lines jl
    ON jl.journal_entry_id=je.id AND jl.account_id=am.account_id
  WHERE je.branch_id=v_sale.branch_id
    AND je.reference_id=v_sale.id
    AND je.reference_type='sale';

  INSERT INTO public.raw_fifo_sale_cogs_adjustments(
    sale_id,branch_id,exact_delta,posted_delta
  ) VALUES (
    v_sale.id,v_sale.branch_id,p_delta,0
  )
  ON CONFLICT (sale_id) DO UPDATE
  SET exact_delta=public.raw_fifo_sale_cogs_adjustments.exact_delta+EXCLUDED.exact_delta,
      updated_at=now()
  RETURNING * INTO v_row;

  IF v_base_cogs+v_row.exact_delta < -0.005 THEN
    RAISE EXCEPTION 'FIFO_SALE_COGS_NEGATIVE sale=% base=% delta=%',
      v_sale.id,v_base_cogs,v_row.exact_delta;
  END IF;

  v_target_posted:=round(v_row.exact_delta,2);
  v_post_delta:=v_target_posted-v_row.posted_delta;

  IF v_target_posted=0 THEN
    v_entry_id:=v_row.journal_entry_id;

    IF v_entry_id IS NOT NULL THEN
      DELETE FROM public.journal_entries
      WHERE id=v_entry_id
        AND reference_type='fifo_cogs_reconcile';
    END IF;

    DELETE FROM public.raw_fifo_sale_cogs_adjustments
    WHERE sale_id=v_sale.id;

    RETURN jsonb_build_object(
      'success',true,
      'exact_delta',0,
      'posted_delta',0,
      'journal_entry_id',NULL
    );
  END IF;

  IF v_post_delta=0 THEN
    RETURN jsonb_build_object(
      'success',true,
      'exact_delta',v_row.exact_delta,
      'posted_delta',v_row.posted_delta
    );
  END IF;

  v_entry_id:=v_row.journal_entry_id;

  IF v_entry_id IS NULL THEN
    v_entry_number:=(public.next_document_number('journal')->>'number')::text;

    INSERT INTO public.journal_entries(
      entry_number,branch_id,entry_date,reference_type,reference_id,
      reference_number,description,created_by
    ) VALUES (
      v_entry_number,
      v_sale.branch_id,
      (v_sale.created_at AT TIME ZONE 'Africa/Cairo')::date,
      'fifo_cogs_reconcile',
      v_sale.id,
      v_sale.invoice_number,
      'FIFO COGS reconciliation '||COALESCE(v_sale.invoice_number,v_sale.id::text),
      auth.uid()
    )
    RETURNING id INTO v_entry_id;

    UPDATE public.raw_fifo_sale_cogs_adjustments
    SET journal_entry_id=v_entry_id
    WHERE sale_id=v_sale.id;
  END IF;

  SELECT account_id INTO v_cogs_account
  FROM public.account_mappings
  WHERE branch_id=v_sale.branch_id AND semantic_key='cogs';

  SELECT account_id INTO v_inventory_account
  FROM public.account_mappings
  WHERE branch_id=v_sale.branch_id AND semantic_key='inventory_fg';

  IF v_cogs_account IS NULL OR v_inventory_account IS NULL THEN
    RAISE EXCEPTION 'FIFO_ACCOUNT_MAPPING_MISSING branch=%',v_sale.branch_id;
  END IF;

  SELECT id INTO v_cogs_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_cogs_account
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_cogs_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_cogs_account,
      GREATEST(v_target_posted,0),
      GREATEST(-v_target_posted,0),
      'FIFO COGS reconciliation'
    )
    RETURNING id INTO v_cogs_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(v_target_posted,0),
        credit=GREATEST(-v_target_posted,0)
    WHERE id=v_cogs_line;
  END IF;

  SELECT id INTO v_inventory_line
  FROM public.journal_entry_lines
  WHERE journal_entry_id=v_entry_id AND account_id=v_inventory_account
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_inventory_line IS NULL THEN
    INSERT INTO public.journal_entry_lines(
      journal_entry_id,account_id,debit,credit,note
    ) VALUES (
      v_entry_id,v_inventory_account,
      GREATEST(-v_target_posted,0),
      GREATEST(v_target_posted,0),
      'FIFO inventory reconciliation'
    )
    RETURNING id INTO v_inventory_line;
  ELSE
    UPDATE public.journal_entry_lines
    SET debit=GREATEST(-v_target_posted,0),
        credit=GREATEST(v_target_posted,0)
    WHERE id=v_inventory_line;
  END IF;

  UPDATE public.raw_fifo_sale_cogs_adjustments
  SET posted_delta=v_target_posted,
      updated_at=now()
  WHERE sale_id=v_sale.id;

  RETURN jsonb_build_object(
    'success',true,
    'exact_delta',v_row.exact_delta,
    'posted_delta',v_target_posted,
    'journal_entry_id',v_entry_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._fifo_adjust_kitchen_effect_delta(
  p_event_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_event public.order_kitchen_inventory_events%ROWTYPE;
  v_sale_delta numeric(18,6):=0;
  v_res jsonb;
BEGIN
  IF p_event_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  SELECT * INTO v_event
  FROM public.order_kitchen_inventory_events
  WHERE id=p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_KITCHEN_EVENT_NOT_FOUND');
  END IF;

  UPDATE public.order_kitchen_inventory_effects
  SET total_cost=total_cost+p_delta
  WHERE event_id=p_event_id
    AND target_type=p_target_type
    AND target_id=p_target_id
    AND total_cost+p_delta>=-0.000001;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_KITCHEN_EFFECT_NOT_FOUND',
      'event_id',p_event_id,
      'target_type',p_target_type,
      'target_id',p_target_id
    );
  END IF;

  UPDATE public.order_kitchen_inventory_events
  SET total_cost=total_cost+p_delta
  WHERE id=p_event_id
    AND total_cost+p_delta>=-0.000001;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','FIFO_KITCHEN_EVENT_COST_NEGATIVE',
      'event_id',p_event_id,
      'delta',p_delta
    );
  END IF;

  IF v_event.settled_sale_id IS NOT NULL
     AND COALESCE(v_event.sent_quantity,0)>0 THEN
    v_sale_delta:=p_delta
      * GREATEST(v_event.sent_quantity-COALESCE(v_event.voided_quantity,0),0)
      / v_event.sent_quantity;

    IF v_sale_delta<>0 THEN
      v_res:=public._fifo_adjust_sale_cogs_delta(
        v_event.settled_sale_id,
        v_sale_delta
      );
      IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
        RETURN v_res;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'event_delta',p_delta,
    'sale_delta',v_sale_delta
  );
END;
$function$;

-- Bootstrap mutually recursive reference/production propagation.
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
SET search_path TO public, pg_temp
AS $function$
BEGIN
  RETURN jsonb_build_object('success',false,'error','FIFO_REFERENCE_PROPAGATION_NOT_INITIALIZED');
END;
$function$;

CREATE OR REPLACE FUNCTION public._fifo_adjust_production_delta(
  p_production_id uuid,
  p_delta numeric,
  p_depth integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_prod public.inventory_unit_productions%ROWTYPE;
  v_output record;
  v_consumer record;
  v_delta_per_unit numeric(18,8);
  v_consumer_delta numeric(18,6);
  v_res jsonb;
BEGIN
  IF p_production_id IS NULL OR COALESCE(p_delta,0)=0 THEN
    RETURN jsonb_build_object('success',true,'delta',0);
  END IF;

  IF p_depth>16 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRODUCTION_PROPAGATION_TOO_DEEP');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('fifo-production:'||p_production_id::text,0)
  );

  SELECT * INTO v_prod
  FROM public.inventory_unit_productions
  WHERE id=p_production_id
  FOR UPDATE;

  IF v_prod.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRODUCTION_NOT_FOUND');
  END IF;

  IF COALESCE(v_prod.quantity,0)<=0 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_INVALID_PRODUCTION_QUANTITY');
  END IF;

  v_delta_per_unit:=p_delta/v_prod.quantity;

  IF COALESCE(v_prod.total_cost,0)+p_delta < -0.000001 THEN
    RETURN jsonb_build_object('success',false,'error','FIFO_PRODUCTION_COST_NEGATIVE');
  END IF;

  UPDATE public.inventory_unit_productions
  SET total_cost=GREATEST(total_cost+p_delta,0),
      updated_at=now()
  WHERE id=v_prod.id;

  FOR v_output IN
    SELECT id,unit_id,branch_id,warehouse_id,batch_number,quantity
    FROM public.inventory_unit_entries
    WHERE reference_type='production'
      AND reference_id=v_prod.id
      AND entry_type='production'
      AND quantity>0
    ORDER BY created_at,id
  LOOP
    IF v_output.quantity>0 AND EXISTS(
      SELECT 1 FROM public.inventory_unit_entries e
      WHERE e.id=v_output.id AND e.unit_cost+v_delta_per_unit < -0.000001
    ) THEN
      RETURN jsonb_build_object('success',false,'error','FIFO_UNIT_COST_NEGATIVE');
    END IF;

    UPDATE public.inventory_unit_entries
    SET unit_cost=GREATEST(unit_cost+v_delta_per_unit,0)
    WHERE id=v_output.id;

    UPDATE public.inventory_unit_batches
    SET unit_cost=GREATEST(unit_cost+v_delta_per_unit,0)
    WHERE unit_id=v_output.unit_id
      AND branch_id=v_output.branch_id
      AND warehouse_id IS NOT DISTINCT FROM v_output.warehouse_id
      AND batch_number IS NOT DISTINCT FROM v_output.batch_number;

    FOR v_consumer IN
      SELECT id,quantity,reference_type,reference_id
      FROM public.inventory_unit_entries
      WHERE unit_id=v_output.unit_id
        AND branch_id=v_output.branch_id
        AND warehouse_id IS NOT DISTINCT FROM v_output.warehouse_id
        AND batch_number IS NOT DISTINCT FROM v_output.batch_number
        AND quantity<0
      ORDER BY created_at,id
      FOR UPDATE
    LOOP
      v_consumer_delta:=(-v_consumer.quantity)*v_delta_per_unit;

      UPDATE public.inventory_unit_entries
      SET unit_cost=GREATEST(unit_cost+v_delta_per_unit,0)
      WHERE id=v_consumer.id;

      IF v_consumer_delta<>0 THEN
        v_res:=public._fifo_adjust_reference_delta(
          v_consumer.reference_type,
          v_consumer.reference_id,
          v_output.branch_id,
          v_output.warehouse_id,
          'inventory_unit',
          v_output.unit_id,
          v_consumer_delta,
          p_depth+1
        );
        IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN
          RETURN v_res;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'production_id',v_prod.id,
    'delta',p_delta,
    'delta_per_unit',v_delta_per_unit
  );
END;
$function$;

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
SET search_path TO public, pg_temp
AS $function$
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
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'delta',p_delta,
    'ignored_reference_type',p_reference_type
  );
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
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_receipt public.inventory_ledger%ROWTYPE;
  v_batch public.raw_material_batches%ROWTYPE;
  v_debt record;
  v_source public.inventory_ledger%ROWTYPE;
  v_take numeric(18,6);
  v_available numeric(18,6);
  v_delta numeric(18,6);
  v_settlement_id uuid;
  v_res jsonb;
  v_total_settled numeric(18,6):=0;
  v_total_value numeric(18,6):=0;
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

    v_take:=LEAST(
      v_available,
      v_debt.debt_quantity-v_debt.settled_quantity
    );
    IF v_take<=0 THEN CONTINUE; END IF;

    INSERT INTO public.raw_fifo_settlements(
      debt_id,receipt_ledger_id,receipt_batch_id,
      quantity,unit_cost,total_cost,run_id
    ) VALUES (
      v_debt.id,
      v_receipt.id,
      v_batch.id,
      v_take,
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

    v_delta:=v_take*COALESCE(v_receipt.unit_cost,0);

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
    SET total_cost=total_cost-v_delta,
        unit_cost=CASE
          WHEN quantity<0 THEN
            abs((total_cost-v_delta)/quantity)
          ELSE unit_cost
        END
    WHERE id=v_source.id;

    IF v_delta>0 THEN
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
        UPDATE public.raw_fifo_settlements
        SET reconciliation_status='error',
            reconciliation_error=COALESCE(v_res->>'error','FIFO_REFERENCE_RECONCILIATION_FAILED')
        WHERE id=v_settlement_id;
      END IF;
    END IF;

    v_available:=v_available-v_take;
    v_total_settled:=v_total_settled+v_take;
    v_total_value:=v_total_value+v_delta;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,
    'settled_value',v_total_value,
    'remaining_receipt_quantity',v_available
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'production',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_remaining numeric(14,4);
  v_batch record;
  v_deduct numeric(14,4);
  v_running numeric(14,4):=0;
  v_branch_qty numeric(14,4):=0;
  v_branch_value numeric(18,4):=0;
  v_total_cost numeric(18,4):=0;
  v_total_removed numeric(14,4):=0;
  v_oversold numeric(14,4):=0;
  v_debt_batch text;
  v_debt_batch_id uuid;
  v_oversold_ledger_id bigint;
  v_oversold_created_at timestamptz;
BEGIN
  IF p_qty IS NULL OR p_qty<=0 THEN
    RETURN jsonb_build_object(
      'success',true,'shortage',0,'removed',0,'total_cost',0,'avg_cost',0
    );
  END IF;

  IF p_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_REQUIRED');
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.warehouses
    WHERE id=p_warehouse_id AND branch_id=p_branch_id AND is_active
  ) THEN
    RETURN jsonb_build_object('success',false,'error','WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_raw_material_id::text||':'||p_branch_id::text,0)
  );

  SELECT COALESCE(SUM(quantity),0)
  INTO v_running
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id
    AND warehouse_id=p_warehouse_id;

  v_remaining:=p_qty;

  FOR v_batch IN
    SELECT id,quantity,unit_cost,batch_number
    FROM public.raw_material_batches
    WHERE raw_material_id=p_raw_material_id
      AND branch_id=p_branch_id
      AND warehouse_id=p_warehouse_id
      AND quantity>0
    ORDER BY expiry_date NULLS LAST,created_at,id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_deduct:=LEAST(v_batch.quantity,v_remaining);

    UPDATE public.raw_material_batches
    SET quantity=quantity-v_deduct
    WHERE id=v_batch.id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_batch.batch_number,
      -v_deduct,COALESCE(v_batch.unit_cost,0),
      -v_deduct*COALESCE(v_batch.unit_cost,0),
      v_running,v_running-v_deduct,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    );

    v_running:=v_running-v_deduct;
    v_remaining:=v_remaining-v_deduct;
    v_total_removed:=v_total_removed+v_deduct;
    v_total_cost:=v_total_cost+v_deduct*COALESCE(v_batch.unit_cost,0);
  END LOOP;

  IF v_remaining>0 AND p_allow_negative THEN
    v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);

    INSERT INTO public.raw_material_batches(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,production_date,expiry_date,source_type,source_id
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,0,NULL,NULL,
      COALESCE(NULLIF(p_reference_type,''),p_entry_type)||'_oversold',
      p_reference_id
    )
    RETURNING id INTO v_debt_batch_id;

    INSERT INTO public.inventory_ledger(
      raw_material_id,branch_id,warehouse_id,batch_number,
      quantity,unit_cost,total_cost,before_qty,after_qty,
      entry_type,reference_type,reference_id,reference_number,created_by
    ) VALUES (
      p_raw_material_id,p_branch_id,p_warehouse_id,v_debt_batch,
      -v_remaining,0,0,v_running,v_running-v_remaining,
      p_entry_type,p_reference_type,p_reference_id,p_reference_number,p_created_by
    )
    RETURNING id,created_at INTO v_oversold_ledger_id,v_oversold_created_at;

    INSERT INTO public.raw_fifo_debts(
      source_ledger_id,raw_material_id,branch_id,warehouse_id,
      oversold_batch_id,reference_type,reference_id,reference_number,
      debt_quantity,settled_quantity,source_created_at
    ) VALUES (
      v_oversold_ledger_id,p_raw_material_id,p_branch_id,p_warehouse_id,
      v_debt_batch_id,p_reference_type,p_reference_id,p_reference_number,
      v_remaining,0,v_oversold_created_at
    )
    ON CONFLICT (source_ledger_id) DO NOTHING;

    v_running:=v_running-v_remaining;
    v_oversold:=v_remaining;
    v_remaining:=0;
  END IF;

  SELECT
    COALESCE(SUM(quantity),0),
    COALESCE(SUM(quantity*COALESCE(unit_cost,0)),0)
  INTO v_branch_qty,v_branch_value
  FROM public.raw_material_batches
  WHERE raw_material_id=p_raw_material_id
    AND branch_id=p_branch_id;

  INSERT INTO public.raw_material_inventory(
    raw_material_id,branch_id,quantity,avg_cost
  ) VALUES (
    p_raw_material_id,p_branch_id,v_branch_qty,
    CASE WHEN v_branch_qty>0 THEN round(v_branch_value/v_branch_qty,2) ELSE 0 END
  )
  ON CONFLICT(raw_material_id,branch_id) DO UPDATE
  SET quantity=EXCLUDED.quantity,
      avg_cost=EXCLUDED.avg_cost,
      updated_at=now();

  RETURN jsonb_build_object(
    'success',true,
    'shortage',v_remaining,
    'removed',v_total_removed,
    'total_cost',v_total_cost,
    'avg_cost',CASE
      WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2)
      ELSE 0
    END,
    'warehouse_id',p_warehouse_id,
    'oversold',v_oversold,
    'debt_batch_number',v_debt_batch,
    'fifo_debt_ledger_id',v_oversold_ledger_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._raw_add(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_qty numeric,
  p_unit_cost numeric DEFAULT 0,
  p_batch_number text DEFAULT NULL,
  p_production_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_entry_type text DEFAULT 'purchase',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public, pg_temp
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

  v_fifo:=public._raw_fifo_settle_receipt(
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

-- Canonical COGS reader: prefer posted sale journals + FIFO reconciliation.
-- Fallbacks preserve compatibility for old rows without journals.
CREATE OR REPLACE FUNCTION public.get_costing_sales_summary(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH scoped_sales AS (
  SELECT
    s.id,
    s.branch_id,
    GREATEST(COALESCE(s.total,0)-COALESCE(s.tax_amount,0),0)::numeric AS net_sales
  FROM public.sales s
  WHERE (p_branch_id IS NULL OR s.branch_id=p_branch_id)
    AND (
      public.history_clamp_from(p_from) IS NULL
      OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=public.history_clamp_from(p_from)
    )
    AND (
      public.history_clamp_to(p_to) IS NULL
      OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=public.history_clamp_to(p_to)
    )
    AND COALESCE(s.status,'') NOT IN ('returned','cancelled')
),
journal_costs AS (
  SELECT
    ss.id AS sale_id,
    round(COALESCE(sum(jl.debit-jl.credit),0),2)::numeric AS cogs
  FROM scoped_sales ss
  JOIN public.journal_entries je
    ON je.branch_id=ss.branch_id
   AND je.reference_id=ss.id
   AND je.reference_type IN ('sale','fifo_cogs_reconcile')
  JOIN public.account_mappings am
    ON am.branch_id=ss.branch_id
   AND am.semantic_key='cogs'
  JOIN public.journal_entry_lines jl
    ON jl.journal_entry_id=je.id
   AND jl.account_id=am.account_id
  GROUP BY ss.id
),
kitchen_costs AS (
  SELECT
    e.settled_sale_id AS sale_id,
    round(COALESCE(sum(
      CASE
        WHEN e.sent_quantity>0 THEN
          COALESCE(e.total_cost,0)
          * GREATEST(e.sent_quantity-COALESCE(e.voided_quantity,0),0)
          / e.sent_quantity
        ELSE 0
      END
    ),0),2)::numeric AS cogs
  FROM public.order_kitchen_inventory_events e
  JOIN scoped_sales ss ON ss.id=e.settled_sale_id
  WHERE e.settled_sale_id IS NOT NULL
  GROUP BY e.settled_sale_id
),
legacy_costs AS (
  SELECT
    il.reference_id AS sale_id,
    GREATEST(COALESCE(-sum(il.total_cost),0),0)::numeric AS cogs
  FROM public.inventory_ledger il
  JOIN scoped_sales ss ON ss.id=il.reference_id
  WHERE il.entry_type='sale' AND il.reference_type='sale'
  GROUP BY il.reference_id
),
resolved_costs AS (
  SELECT
    ss.id sale_id,
    CASE
      WHEN jc.sale_id IS NOT NULL THEN COALESCE(jc.cogs,0)
      WHEN kc.sale_id IS NOT NULL THEN COALESCE(kc.cogs,0)
      ELSE COALESCE(lc.cogs,0)
    END::numeric AS cogs
  FROM scoped_sales ss
  LEFT JOIN journal_costs jc ON jc.sale_id=ss.id
  LEFT JOIN kitchen_costs kc ON kc.sale_id=ss.id
  LEFT JOIN legacy_costs lc ON lc.sale_id=ss.id
),
totals AS (
  SELECT
    count(*)::integer AS sales_count,
    round(COALESCE(sum(ss.net_sales),0),2) AS net_sales,
    round(COALESCE(sum(rc.cogs),0),2) AS cogs
  FROM scoped_sales ss
  LEFT JOIN resolved_costs rc ON rc.sale_id=ss.id
)
SELECT jsonb_build_object(
  'sales_count',sales_count,
  'net_sales',net_sales,
  'cogs',cogs,
  'ratio',CASE WHEN net_sales>0 THEN round(cogs*100.0/net_sales,2) ELSE 0 END
)
FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.get_order_margin(
  p_branch_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE(
  sale_id uuid,
  invoice_number text,
  branch_id uuid,
  sale_date date,
  total numeric,
  discount_amount numeric,
  cogs numeric,
  gross_margin numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_branch uuid;
  v_scope uuid;
BEGIN
  IF NOT is_pos_admin() THEN
    SELECT u.branch_id INTO v_user_branch
    FROM public.users u
    WHERE u.id=auth.uid();
    v_scope:=v_user_branch;
  ELSE
    v_scope:=p_branch_id;
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT s.*
    FROM public.sales s
    WHERE (v_scope IS NULL OR s.branch_id=v_scope)
      AND (
        public.history_clamp_from(p_from) IS NULL
        OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date>=public.history_clamp_from(p_from)
      )
      AND (
        public.history_clamp_to(p_to) IS NULL
        OR (s.created_at AT TIME ZONE 'Africa/Cairo')::date<=public.history_clamp_to(p_to)
      )
  ),
  journal_costs AS (
    SELECT
      s.id sale_id,
      round(COALESCE(sum(jl.debit-jl.credit),0),2)::numeric AS cogs
    FROM scoped s
    JOIN public.journal_entries je
      ON je.branch_id=s.branch_id
     AND je.reference_id=s.id
     AND je.reference_type IN ('sale','fifo_cogs_reconcile')
    JOIN public.account_mappings am
      ON am.branch_id=s.branch_id
     AND am.semantic_key='cogs'
    JOIN public.journal_entry_lines jl
      ON jl.journal_entry_id=je.id
     AND jl.account_id=am.account_id
    GROUP BY s.id
  ),
  legacy_costs AS (
    SELECT
      s.id sale_id,
      GREATEST(COALESCE(-sum(il.total_cost),0),0)::numeric AS cogs
    FROM scoped s
    LEFT JOIN public.inventory_ledger il
      ON il.reference_id=s.id
     AND il.entry_type='sale'
     AND il.reference_type='sale'
    GROUP BY s.id
  )
  SELECT
    s.id,
    s.invoice_number,
    s.branch_id,
    (s.created_at AT TIME ZONE 'Africa/Cairo')::date,
    COALESCE(s.total,0),
    COALESCE(s.discount_amount,0),
    COALESCE(jc.cogs,lc.cogs,0)::numeric(16,2),
    round(COALESCE(s.total,0)-COALESCE(jc.cogs,lc.cogs,0),2)::numeric(16,2)
  FROM scoped s
  LEFT JOIN journal_costs jc ON jc.sale_id=s.id
  LEFT JOIN legacy_costs lc ON lc.sale_id=s.id
  ORDER BY s.created_at DESC
  LIMIT 500;
END;
$function$;

REVOKE ALL ON FUNCTION public._fifo_adjust_sale_cogs_delta(uuid,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fifo_adjust_kitchen_effect_delta(uuid,text,uuid,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fifo_adjust_reference_delta(text,uuid,uuid,uuid,text,uuid,numeric,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._fifo_adjust_production_delta(uuid,numeric,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._raw_fifo_settle_receipt(bigint,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._fifo_adjust_sale_cogs_delta(uuid,numeric)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_kitchen_effect_delta(uuid,text,uuid,numeric)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_reference_delta(text,uuid,uuid,uuid,text,uuid,numeric,integer)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._fifo_adjust_production_delta(uuid,numeric,integer)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public._raw_fifo_settle_receipt(bigint,uuid,uuid)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.get_costing_sales_summary(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_costing_sales_summary(uuid,date,date)
  TO authenticated, service_role;

COMMIT;
