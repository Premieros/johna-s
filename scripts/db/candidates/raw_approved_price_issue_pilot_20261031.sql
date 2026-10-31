-- EXPERIMENT ONLY: must be run only in rollback-only disposable PostgreSQL.
-- DO NOT place under supabase/migrations or apply to production.
-- Proves frozen approved-price snapshots on NEW negative raw issues,
-- and prevents double-costing on subsequent FIFO debt settlement.
-- Historical issues and all positive-lot consumption are unchanged.
-- Non-zero settlement variances remain UNPOSTED and BLOCK release until
-- a separately tested, balanced-journal variance posting lifecycle exists.
SET LOCAL lock_timeout = '2s';

CREATE TABLE private.raw_approved_negative_issue_snapshots (
  source_ledger_id bigint PRIMARY KEY REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  debt_id uuid UNIQUE NOT NULL REFERENCES public.raw_fifo_debts(id) ON DELETE RESTRICT,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  approved_unit_cost numeric(18,6) NOT NULL CHECK (approved_unit_cost > 0),
  price_source text NOT NULL CHECK (price_source IN ('purchase','pricing','stock_count')),
  priced_at timestamptz NOT NULL,
  reference_number text,
  captured_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
REVOKE ALL ON private.raw_approved_negative_issue_snapshots FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.raw_approved_cost_variances (
  settlement_id uuid PRIMARY KEY REFERENCES public.raw_fifo_settlements(id) ON DELETE RESTRICT,
  source_ledger_id bigint NOT NULL REFERENCES public.inventory_ledger(id) ON DELETE RESTRICT,
  approved_unit_cost numeric(18,6) NOT NULL,
  receipt_unit_cost numeric(18,6) NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  difference_amount numeric(18,6) NOT NULL,
  journal_status text NOT NULL DEFAULT 'unposted' CHECK (journal_status IN ('unposted','posted')),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
REVOKE ALL ON private.raw_approved_cost_variances FROM PUBLIC, anon, authenticated, service_role;

DO $cutover_issue$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT replace(pg_get_functiondef('public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)'::regprocedure),chr(13),'')
  INTO STRICT v_def;
  IF position('APPROVED_NEGATIVE_ISSUE_PILOT_V1' IN v_def)>0 THEN
    RAISE EXCEPTION 'APPROVED_NEGATIVE_ISSUE_ALREADY_INSTALLED';
  END IF;

  v_old := $old$  v_oversold_created_at timestamptz;$old$;
  v_new := $new$  v_oversold_created_at timestamptz;
  v_approved_price record;
  v_approved_unit_cost numeric(18,6) := 0;
  v_debt_id uuid;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_ISSUE_DECLARE_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$  IF v_remaining>0 AND p_allow_negative THEN
    v_debt_batch:=$old$;
  v_new := $new$  IF v_remaining>0 AND p_allow_negative THEN
    -- APPROVED_NEGATIVE_ISSUE_PILOT_V1: capture canonical approved price
    -- as of this stock operation, not a batch average or catalog default.
    SELECT cp.unit_cost,cp.price_source,cp.priced_at,cp.reference_number
    INTO v_approved_price
    FROM public._kitchen_approved_price_candidate(
      p_branch_id, ARRAY[p_raw_material_id], statement_timestamp()
    ) cp WHERE cp.raw_material_id=p_raw_material_id
      AND cp.price_source IN ('purchase','pricing','stock_count');
    v_approved_unit_cost := COALESCE(v_approved_price.unit_cost,0);
    -- If no approved price exists, keep the legacy zero-cost path
    -- explicitly; never pretend a catalog default is approved.
    v_debt_batch:=$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_ISSUE_PRICE_LOOKUP_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$      -v_remaining,0,NULL,NULL,$old$;
  v_new := $new$      -v_remaining,v_approved_unit_cost,NULL,NULL,$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_ISSUE_OV_BATCH_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$      -v_remaining,0,0,v_running,v_running-v_remaining,$old$;
  v_new := $new$      -v_remaining,v_approved_unit_cost,
      -v_remaining*v_approved_unit_cost,v_running,v_running-v_remaining,$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_ISSUE_OV_LEDGER_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$    ON CONFLICT (source_ledger_id) DO NOTHING;

    v_running:=v_running-v_remaining;$old$;
  v_new := $new$    ON CONFLICT (source_ledger_id) DO NOTHING;

    IF v_approved_unit_cost>0 THEN
      SELECT id INTO STRICT v_debt_id
      FROM public.raw_fifo_debts WHERE source_ledger_id=v_oversold_ledger_id;
      INSERT INTO private.raw_approved_negative_issue_snapshots (
        source_ledger_id,debt_id,raw_material_id,branch_id,warehouse_id,
        approved_unit_cost,price_source,priced_at,reference_number
      ) VALUES (
        v_oversold_ledger_id,v_debt_id,p_raw_material_id,p_branch_id,p_warehouse_id,
        v_approved_unit_cost,v_approved_price.price_source,
        v_approved_price.priced_at,v_approved_price.reference_number
      );
    END IF;
    v_total_cost:=v_total_cost+v_remaining*v_approved_unit_cost;
    v_running:=v_running-v_remaining;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_ISSUE_SNAPSHOT_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old := $old$WHEN v_total_removed>0 THEN round(v_total_cost/v_total_removed,2)$old$;
  v_new := $new$WHEN v_total_removed+v_oversold>0 THEN round(v_total_cost/(v_total_removed+v_oversold),2)$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_ISSUE_AVG_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  EXECUTE v_def;
END;
$cutover_issue$;

DO $cutover_settle$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT replace(pg_get_functiondef('public._raw_fifo_settle_receipt(bigint,uuid,uuid)'::regprocedure),chr(13),'')
    INTO STRICT v_def;
  IF position('APPROVED_NEGATIVE_RECEIPT_PILOT_V1' IN v_def)>0 THEN
    RAISE EXCEPTION 'APPROVED_NEGATIVE_RECEIPT_ALREADY_INSTALLED';
  END IF;

  v_old:=$old$  v_estimate public.raw_fifo_debt_price_estimates%ROWTYPE;$old$;
  v_new:=$new$  v_estimate public.raw_fifo_debt_price_estimates%ROWTYPE;
  v_approved_issue private.raw_approved_negative_issue_snapshots%ROWTYPE;
  v_pending_variances integer;
  v_total_variance numeric(18,6);
  v_posted_variance numeric(18,2);
  v_stock_variance_account uuid;
  v_inventory_account uuid;
  v_variance_journal uuid;
  v_variance_ref uuid;
  v_variance_doc text;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_RECEIPT_DECLARE_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);

  v_old:=$old$    v_new_total:=COALESCE(v_source.total_cost,0)-v_delta;$old$;
  v_new:=$new$    -- APPROVED_NEGATIVE_RECEIPT_PILOT_V1:
    -- Existing historical FIFO debts retain their original reconciliation.
    -- New issues already booked with their approved cost cannot be costed
    -- again when incoming stock arrives. Record actual-minus-approved
    -- variance for a separate audited journal, never silently discard it.
    SELECT * INTO v_approved_issue
    FROM private.raw_approved_negative_issue_snapshots
    WHERE source_ledger_id=v_source.id AND debt_id=v_debt.id
    FOR UPDATE;
    IF v_approved_issue.source_ledger_id IS NOT NULL THEN
      IF v_estimate.debt_id IS NOT NULL THEN
        RAISE EXCEPTION 'APPROVED_ISSUE_CONFLICTS_WITH_HISTORIC_ESTIMATE ledger=%',v_source.id;
      END IF;
      INSERT INTO private.raw_approved_cost_variances(
        settlement_id,source_ledger_id,approved_unit_cost,receipt_unit_cost,
        quantity,difference_amount
      ) VALUES (
        v_settlement_id,v_source.id,v_approved_issue.approved_unit_cost,
        COALESCE(v_receipt.unit_cost,0),v_take,
        v_take*(COALESCE(v_receipt.unit_cost,0)-v_approved_issue.approved_unit_cost)
      );
      -- Keep the historical approved issue cost immutable. The difference
      -- is a tracked, unposted variance, NOT an automatic sales rewrite.
      v_delta:=0;
    END IF;
    v_new_total:=COALESCE(v_source.total_cost,0)-v_delta;$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_RECEIPT_SETTLEMENT_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);
  v_old:=$old$  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,$old$;
  v_new:=$new$  -- One balanced variance journal per receipt, never one per kitchen
  -- debt. The journal belongs to this receipt period, not historic sales.
  SELECT count(*),COALESCE(sum(v.difference_amount),0)
  INTO v_pending_variances,v_total_variance
  FROM private.raw_approved_cost_variances v
  JOIN public.raw_fifo_settlements s ON s.id=v.settlement_id
  WHERE s.receipt_ledger_id=p_receipt_ledger_id AND v.journal_status='unposted';

  IF v_pending_variances>0 THEN
    v_posted_variance:=round(v_total_variance,2);
    IF abs(v_posted_variance)>=0.01 THEN
      SELECT am.account_id INTO v_stock_variance_account
      FROM public.account_mappings am
      WHERE am.branch_id=v_receipt.branch_id AND am.semantic_key='stock_variance';
      SELECT am.account_id INTO v_inventory_account
      FROM public.account_mappings am
      WHERE am.branch_id=v_receipt.branch_id AND am.semantic_key='inventory_rm';
      IF v_stock_variance_account IS NULL OR v_inventory_account IS NULL
         OR v_stock_variance_account=v_inventory_account THEN
        RAISE EXCEPTION 'APPROVED_PRICE_VARIANCE_ACCOUNT_MAPPING_MISSING branch=%',
          v_receipt.branch_id;
      END IF;

      v_variance_ref:=md5('approved-raw-receipt-variance:'||p_receipt_ledger_id::text)::uuid;
      IF EXISTS (SELECT 1 FROM public.journal_entries
                 WHERE reference_type='raw_approved_receipt_variance' AND reference_id=v_variance_ref) THEN
        RAISE EXCEPTION 'APPROVED_PRICE_VARIANCE_REPEATED_RECEIPT ledger=%',p_receipt_ledger_id;
      END IF;
      v_variance_doc:=(public.next_document_number('journal')->>'number')::text;
      INSERT INTO public.journal_entries (
        entry_number,branch_id,entry_date,reference_type,reference_id,
        reference_number,description,created_by
      ) VALUES (
        v_variance_doc,v_receipt.branch_id,
        (v_receipt.created_at AT TIME ZONE 'Africa/Cairo')::date,
        'raw_approved_receipt_variance',v_variance_ref,
        v_receipt.reference_number,
        'Approved raw issue price variance / receipt ledger '||p_receipt_ledger_id::text,
        auth.uid()
      ) RETURNING id INTO v_variance_journal;
      -- Receipt actual cost above frozen issue price: Dr stock variance
      -- expense / Cr raw inventory. Negative difference reverses both.
      INSERT INTO public.journal_entry_lines(
        journal_entry_id,account_id,debit,credit,note
      ) VALUES (
        v_variance_journal,v_stock_variance_account,
        GREATEST(v_posted_variance,0),GREATEST(-v_posted_variance,0),
        'Frozen approved raw cost / actual receipt variance'
      ),(
        v_variance_journal,v_inventory_account,
        GREATEST(-v_posted_variance,0),GREATEST(v_posted_variance,0),
        'Raw inventory valuation offset'
      );
    END IF;
    UPDATE private.raw_approved_cost_variances v SET
      journal_status='posted',journal_entry_id=v_variance_journal
    FROM public.raw_fifo_settlements s
    WHERE v.settlement_id=s.id
      AND s.receipt_ledger_id=p_receipt_ledger_id
      AND v.journal_status='unposted';
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'settled_quantity',v_total_settled,$new$;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'APPROVED_RECEIPT_POSTING_SOURCE_DRIFT';
  END IF;
  v_def:=replace(v_def,v_old,v_new);
  EXECUTE v_def;
END;
$cutover_settle$;
