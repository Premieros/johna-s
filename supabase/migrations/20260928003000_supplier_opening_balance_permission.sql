-- Supplier opening balance with explicit permission and canonical AP integration.

CREATE TABLE IF NOT EXISTS public.supplier_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  opening_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  settled_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  notes text,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id),
  CHECK (settled_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_supplier_opening_balances_branch
  ON public.supplier_opening_balances(branch_id, opening_date);

ALTER TABLE public.supplier_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_opening_balances_select ON public.supplier_opening_balances;
CREATE POLICY supplier_opening_balances_select
ON public.supplier_opening_balances
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND public.can_permission('suppliers.view')
);

CREATE OR REPLACE FUNCTION public.get_supplier_opening_balance(
  p_supplier_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_row record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('suppliers.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'suppliers.view');
  END IF;

  SELECT id, opening_date, amount, settled_amount, notes, journal_entry_id, created_at
    INTO v_row
  FROM public.supplier_opening_balances
  WHERE supplier_id = p_supplier_id
    AND branch_id = p_branch_id;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'exists', false);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'exists', true,
    'id', v_row.id,
    'opening_date', v_row.opening_date,
    'amount', round(v_row.amount,2),
    'settled_amount', round(v_row.settled_amount,2),
    'remaining_amount', round(v_row.amount-v_row.settled_amount,2),
    'notes', v_row.notes,
    'journal_entry_id', v_row.journal_entry_id,
    'created_at', v_row.created_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_supplier_opening_balance(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_opening_date date,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_journal_id uuid;
  v_lines jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('suppliers.opening_balance.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'suppliers.opening_balance.manage');
  END IF;
  IF p_amount IS NULL OR round(p_amount,2) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF p_opening_date IS NULL OR p_opening_date > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_OPENING_DATE');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id=p_supplier_id AND s.branch_id=p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
  END IF;

  PERFORM public.assert_user_work_authorized_cached(p_branch_id);

  IF EXISTS (
    SELECT 1 FROM public.supplier_opening_balances
    WHERE supplier_id=p_supplier_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'OPENING_BALANCE_ALREADY_EXISTS');
  END IF;

  INSERT INTO public.chart_of_accounts
    (branch_id, code, name, name_en, account_type, is_system, is_active)
  VALUES
    (p_branch_id, '3200', 'حقوق ملكية الرصيد الافتتاحي', 'Opening Balance Equity', 'equity', true, true)
  ON CONFLICT (branch_id, code) DO UPDATE SET
    name=EXCLUDED.name,
    name_en=EXCLUDED.name_en,
    account_type='equity',
    is_active=true,
    updated_at=now();

  INSERT INTO public.supplier_opening_balances
    (supplier_id, branch_id, opening_date, amount, notes, created_by)
  VALUES
    (p_supplier_id, p_branch_id, p_opening_date, round(p_amount,2), NULLIF(btrim(COALESCE(p_notes,'')),''), auth.uid())
  RETURNING id INTO v_id;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code','3200',
      'debit',round(p_amount,2),
      'credit',0,
      'note','رصيد افتتاحي مورد'
    ),
    jsonb_build_object(
      'account_key','ap',
      'debit',0,
      'credit',round(p_amount,2),
      'supplier_id',p_supplier_id,
      'note','رصيد افتتاحي مورد'
    )
  );

  v_journal_id := public._post_journal_entry(
    p_branch_id,
    'supplier_opening_balance',
    v_id,
    'SUP-OPEN-' || left(v_id::text,8),
    'رصيد افتتاحي مورد',
    v_lines
  );

  UPDATE public.journal_entries
  SET entry_date=p_opening_date
  WHERE id=v_journal_id;

  UPDATE public.supplier_opening_balances
  SET journal_entry_id=v_journal_id
  WHERE id=v_id;

  PERFORM public.log_audit_action(
    p_branch_id,
    'supplier_opening_balance_create',
    'supplier_opening_balance',
    v_id,
    jsonb_build_object(
      'supplier_id',p_supplier_id,
      'amount',round(p_amount,2),
      'opening_date',p_opening_date
    )
  );

  RETURN jsonb_build_object(
    'success',true,
    'id',v_id,
    'journal_entry_id',v_journal_id,
    'amount',round(p_amount,2),
    'opening_date',p_opening_date
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ap_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
WITH source_rows AS (
  SELECT
    p.supplier_id,
    (p.total - COALESCE(p.paid_amount,0) - COALESCE(p.returned_amount,0))::numeric AS open_amount,
    (p.created_at AT TIME ZONE 'Africa/Cairo')::date AS source_date
  FROM public.purchases p
  WHERE p.branch_id=p_branch_id
    AND p.status='completed'
    AND (p.created_at AT TIME ZONE 'Africa/Cairo')::date <= public.history_clamp_as_of(p_as_of)
    AND (p.total - COALESCE(p.paid_amount,0) - COALESCE(p.returned_amount,0)) > 0

  UNION ALL

  SELECT
    ob.supplier_id,
    (ob.amount-ob.settled_amount)::numeric,
    ob.opening_date
  FROM public.supplier_opening_balances ob
  WHERE ob.branch_id=p_branch_id
    AND ob.opening_date <= public.history_clamp_as_of(p_as_of)
    AND (ob.amount-ob.settled_amount) > 0
), aggregated AS (
  SELECT
    s.id AS supplier_id,
    s.name,
    s.phone,
    round(sum(sr.open_amount),2) AS open_amount,
    round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of)-sr.source_date)<=30 THEN sr.open_amount ELSE 0 END),2) AS bucket_0_30,
    round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of)-sr.source_date) BETWEEN 31 AND 60 THEN sr.open_amount ELSE 0 END),2) AS bucket_31_60,
    round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of)-sr.source_date) BETWEEN 61 AND 90 THEN sr.open_amount ELSE 0 END),2) AS bucket_61_90,
    round(sum(CASE WHEN (public.history_clamp_as_of(p_as_of)-sr.source_date)>90 THEN sr.open_amount ELSE 0 END),2) AS bucket_90_plus
  FROM source_rows sr
  JOIN public.suppliers s ON s.id=sr.supplier_id
  WHERE s.branch_id=p_branch_id
  GROUP BY s.id,s.name,s.phone
)
SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.open_amount DESC,a.name),'[]'::jsonb)
FROM aggregated a;
$function$;

CREATE OR REPLACE FUNCTION public.get_aging_summary(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
WITH ar_rows AS (
  SELECT value AS r FROM jsonb_array_elements(public.get_ar_aging(p_branch_id,p_as_of))
), ap_rows AS (
  SELECT value AS r FROM jsonb_array_elements(public.get_ap_aging(p_branch_id,p_as_of))
), ar AS (
  SELECT
    round(COALESCE(sum((r->>'open_amount')::numeric),0),2) open_total,
    round(COALESCE(sum((r->>'bucket_0_30')::numeric),0),2) b0,
    round(COALESCE(sum((r->>'bucket_31_60')::numeric),0),2) b31,
    round(COALESCE(sum((r->>'bucket_61_90')::numeric),0),2) b61,
    round(COALESCE(sum((r->>'bucket_90_plus')::numeric),0),2) b90
  FROM ar_rows
), ap AS (
  SELECT
    round(COALESCE(sum((r->>'open_amount')::numeric),0),2) open_total,
    round(COALESCE(sum((r->>'bucket_0_30')::numeric),0),2) b0,
    round(COALESCE(sum((r->>'bucket_31_60')::numeric),0),2) b31,
    round(COALESCE(sum((r->>'bucket_61_90')::numeric),0),2) b61,
    round(COALESCE(sum((r->>'bucket_90_plus')::numeric),0),2) b90
  FROM ap_rows
)
SELECT jsonb_build_object(
  'as_of',public.history_clamp_as_of(p_as_of),
  'ar_open',(SELECT open_total FROM ar),
  'ap_open',(SELECT open_total FROM ap),
  'ar',jsonb_build_object('0_30',(SELECT b0 FROM ar),'31_60',(SELECT b31 FROM ar),'61_90',(SELECT b61 FROM ar),'90_plus',(SELECT b90 FROM ar)),
  'ap',jsonb_build_object('0_30',(SELECT b0 FROM ap),'31_60',(SELECT b31 FROM ap),'61_90',(SELECT b61 FROM ap),'90_plus',(SELECT b90 FROM ap))
);
$function$;

CREATE OR REPLACE FUNCTION public.get_supplier_statement(
  p_supplier_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_summary jsonb;
  v_entries jsonb;
  v_invoice_time_paid numeric := 0;
  v_opening numeric := 0;
  v_opening_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('suppliers.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'suppliers.view');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id=p_supplier_id AND s.branch_id=p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
  END IF;

  SELECT COALESCE(amount,0), opening_date
    INTO v_opening,v_opening_date
  FROM public.supplier_opening_balances
  WHERE supplier_id=p_supplier_id AND branch_id=p_branch_id;

  SELECT jsonb_build_object(
    'supplier_id',s.id,
    'supplier_name',s.name,
    'opening_balance',COALESCE(v_opening,0),
    'total_purchases',COALESCE(x.total_purchases,0),
    'total_returns',COALESCE(x.total_returns,0),
    'total_paid',COALESCE(x.invoice_time_paid,0)+COALESCE(y.recorded_total,0),
    'open_balance',GREATEST(
      COALESCE(v_opening,0)+COALESCE(x.total_purchases,0)-COALESCE(x.total_returns,0)
      -COALESCE(x.invoice_time_paid,0)-COALESCE(y.recorded_total,0),0
    ),
    'recorded_cash_payments',COALESCE(y.cash_paid,0),
    'recorded_card_payments',COALESCE(y.card_paid,0),
    'recorded_transfer_payments',COALESCE(y.transfer_paid,0),
    'recorded_other_payments',COALESCE(y.other_paid,0),
    'recorded_payments_total',COALESCE(y.recorded_total,0),
    'invoice_time_paid',COALESCE(x.invoice_time_paid,0)
  )
  INTO v_summary
  FROM public.suppliers s
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(p.total),0) AS total_purchases,
      COALESCE(sum(p.returned_amount),0) AS total_returns,
      COALESCE(sum(
        CASE
          WHEN p.payment_method='credit' THEN 0
          ELSE GREATEST(
            COALESCE(p.paid_amount,0)-COALESCE((
              SELECT sum(sp_linked.amount)
              FROM public.supplier_payments sp_linked
              WHERE sp_linked.purchase_id=p.id
                AND sp_linked.supplier_id=p.supplier_id
                AND sp_linked.branch_id=p.branch_id
            ),0),0
          )
        END
      ),0) AS invoice_time_paid
    FROM public.purchases p
    WHERE p.supplier_id=s.id AND p.branch_id=p_branch_id AND p.status='completed'
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(sp.amount),0) recorded_total,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method='cash'),0) cash_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method='card'),0) card_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method IN ('transfer','bank_transfer')),0) transfer_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method NOT IN ('cash','card','transfer','bank_transfer')),0) other_paid
    FROM public.supplier_payments sp
    WHERE sp.supplier_id=s.id AND sp.branch_id=p_branch_id
  ) y ON true
  WHERE s.id=p_supplier_id AND s.branch_id=p_branch_id;

  v_invoice_time_paid:=COALESCE((v_summary->>'invoice_time_paid')::numeric,0);

  WITH events AS (
    SELECT
      (v_opening_date::timestamp AT TIME ZONE 'Africa/Cairo') AS event_at,
      'opening_balance'::text AS entry_type,
      p_supplier_id AS source_id,
      NULL::text AS reference_number,
      COALESCE(v_opening,0)::numeric AS debit,
      0::numeric AS credit,
      'opening'::text AS payment_method,
      'Supplier opening balance'::text AS description
    WHERE COALESCE(v_opening,0)>0

    UNION ALL

    SELECT
      p.created_at,'purchase'::text,p.id,p.invoice_number,
      GREATEST(COALESCE(p.total,0)-COALESCE(p.returned_amount,0),0)::numeric,
      0::numeric,p.payment_method::text,
      CASE WHEN COALESCE(p.returned_amount,0)>0 THEN 'Net purchase after returns' ELSE 'Purchase invoice' END::text
    FROM public.purchases p
    WHERE p.supplier_id=p_supplier_id AND p.branch_id=p_branch_id AND p.status='completed'

    UNION ALL

    SELECT
      COALESCE((SELECT max(p.created_at) FROM public.purchases p WHERE p.supplier_id=p_supplier_id AND p.branch_id=p_branch_id AND p.status='completed'),now())+interval '1 microsecond',
      'invoice_time_payment'::text,p_supplier_id,NULL::text,0::numeric,v_invoice_time_paid,'invoice_time'::text,
      'Aggregate payments captured when non-credit purchase invoices were created'::text
    WHERE v_invoice_time_paid>0

    UNION ALL

    SELECT
      sp.created_at,'payment'::text,sp.id,sp.reference_number,0::numeric,COALESCE(sp.amount,0)::numeric,
      sp.payment_method::text,COALESCE(NULLIF(sp.notes,''),'Supplier payment')::text
    FROM public.supplier_payments sp
    WHERE sp.supplier_id=p_supplier_id AND sp.branch_id=p_branch_id
  ), running AS (
    SELECT e.*,
      sum(e.debit-e.credit) OVER (
        ORDER BY e.event_at,e.entry_type,e.source_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM events e
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event_at',r.event_at,
    'entry_type',r.entry_type,
    'source_id',r.source_id,
    'reference_number',r.reference_number,
    'debit',round(r.debit,2),
    'credit',round(r.credit,2),
    'payment_method',r.payment_method,
    'description',r.description,
    'running_balance',round(r.running_balance,2)
  ) ORDER BY r.event_at DESC,r.entry_type DESC,r.source_id DESC),'[]'::jsonb)
  INTO v_entries
  FROM running r;

  RETURN jsonb_build_object('success',true,'summary',v_summary,'entries',v_entries);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_supplier_from_treasury(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_treasury_account_id uuid,
  p_purchase_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_payment_id uuid;
  v_tx_id uuid;
  v_number text;
  v_remaining numeric(14,2);
  v_purchase record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_opening_open numeric(14,2) := 0;
  v_supplier_org uuid;
  v_source record;
  v_source_balance numeric(18,2);
  v_source_code text;
  v_payment_method text;
  v_lines jsonb := '[]'::jsonb;
  v_funding_lines jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  IF NOT public.can_permission('procurement.payment.create') THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'NOT_ALLOWED',
      'detail', 'Supplier payments require procurement.payment.create.'
    );
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT b.organization_id
    INTO v_supplier_org
  FROM public.branches b
  WHERE b.id = p_branch_id
    AND b.is_active;

  IF NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = p_supplier_id
      AND s.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
  END IF;

  -- Lock the selected funding account for the duration of the payment.
  SELECT
    t.id,
    t.branch_id,
    t.organization_id,
    t.account_id,
    t.account_type,
    t.account_name,
    t.scope,
    t.kind,
    t.is_active,
    t.opening_balance
  INTO v_source
  FROM public.treasury_accounts t
  WHERE t.id = p_treasury_account_id
  FOR UPDATE;

  IF v_source.id IS NULL OR NOT v_source.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED');
  END IF;

  IF v_supplier_org IS NOT NULL
     AND v_source.organization_id IS DISTINCT FROM v_supplier_org THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ORGANIZATION_MISMATCH');
  END IF;

  IF v_source.scope = 'organization' THEN
    IF NOT (public.can_permission('accounting.treasury.transfer') OR public.can_permission('accounting.treasury.main_cash.pay')) THEN
      RETURN jsonb_build_object('success', false, 'error', 'MAIN_TREASURY_PAYMENT_PERMISSION_REQUIRED', 'permission', 'accounting.treasury.main_cash.pay');
    END IF;
  ELSIF NOT public.user_may_access_branch(v_source.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_BRANCH_MISMATCH');
  END IF;

  SELECT a.code
    INTO v_source_code
  FROM public.chart_of_accounts a
  WHERE a.id = v_source.account_id
    AND a.branch_id = v_source.branch_id
    AND a.is_active;

  IF v_source_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_MAPPING_MISSING');
  END IF;

  SELECT round(
    COALESCE(v_source.opening_balance, 0)
    + COALESCE(SUM(l.debit - l.credit), 0),
    2
  )
  INTO v_source_balance
  FROM public.journal_entry_lines l
  WHERE l.account_id = v_source.account_id;

  v_source_balance := COALESCE(v_source_balance, round(COALESCE(v_source.opening_balance, 0), 2));

  IF round(p_amount, 2) > v_source_balance THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INSUFFICIENT_TREASURY_BALANCE',
      'available', v_source_balance,
      'requested', round(p_amount, 2)
    );
  END IF;

  SELECT COALESCE(
    SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.returned_amount, 0)),
    0
  )
  INTO v_total_open
  FROM public.purchases s
  WHERE s.supplier_id = p_supplier_id
    AND s.branch_id = p_branch_id
    AND s.status = 'completed';

  SELECT round(GREATEST(COALESCE(ob.amount,0) - COALESCE(ob.settled_amount,0), 0), 2)
    INTO v_opening_open
  FROM public.supplier_opening_balances ob
  WHERE ob.supplier_id = p_supplier_id
    AND ob.branch_id = p_branch_id;

  v_total_open := round(COALESCE(v_total_open,0) + COALESCE(v_opening_open,0), 2);

  IF p_purchase_id IS NULL THEN
    IF round(p_amount, 2) > round(v_total_open, 2) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PAYMENT_EXCEEDS_AP',
        'open', round(v_total_open, 2)
      );
    END IF;
  ELSE
    SELECT
      p.id,
      p.total,
      COALESCE(p.paid_amount, 0) AS paid_amount,
      COALESCE(p.returned_amount, 0) AS returned_amount
    INTO v_purchase
    FROM public.purchases p
    WHERE p.id = p_purchase_id
      AND p.supplier_id = p_supplier_id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'
    FOR UPDATE;

    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;

    IF round(p_amount, 2) >
       round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'PAYMENT_EXCEEDS_INVOICE',
        'open', round(v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount, 2)
      );
    END IF;
  END IF;

  v_number := (public.next_document_number('supplier_payment')->>'number')::text;
  v_payment_method := CASE WHEN v_source.account_type = 'cash' THEN 'cash' ELSE 'transfer' END;

  INSERT INTO public.supplier_payments (
    supplier_id, branch_id, amount, payment_method, purchase_id,
    reference_number, notes, created_by, treasury_account_id
  )
  VALUES (
    p_supplier_id, p_branch_id, round(p_amount, 2), v_payment_method, p_purchase_id,
    v_number, p_notes, auth.uid(), v_source.id
  )
  RETURNING id INTO v_payment_id;

  v_remaining := round(p_amount, 2);

  IF p_purchase_id IS NULL AND v_remaining > 0 THEN
    SELECT round(GREATEST(amount - settled_amount, 0), 2)
      INTO v_opening_open
    FROM public.supplier_opening_balances
    WHERE supplier_id = p_supplier_id
      AND branch_id = p_branch_id
    FOR UPDATE;

    v_applied := LEAST(v_remaining, COALESCE(v_opening_open, 0));
    IF v_applied > 0 THEN
      UPDATE public.supplier_opening_balances
      SET settled_amount = settled_amount + v_applied,
          updated_at = now()
      WHERE supplier_id = p_supplier_id
        AND branch_id = p_branch_id;
      v_remaining := round(v_remaining - v_applied, 2);
    END IF;
  END IF;

  IF p_purchase_id IS NOT NULL THEN
    v_open := round(
      v_purchase.total - v_purchase.paid_amount - v_purchase.returned_amount,
      2
    );
    v_applied := LEAST(v_remaining, v_open);
    UPDATE public.purchases
    SET paid_amount = COALESCE(paid_amount, 0) + v_applied
    WHERE id = p_purchase_id;
    v_remaining := round(v_remaining - v_applied, 2);
  ELSE
    FOR v_purchase IN
      SELECT id, total, paid_amount, returned_amount
      FROM public.purchases
      WHERE supplier_id = p_supplier_id
        AND branch_id = p_branch_id
        AND status = 'completed'
        AND (
          total - COALESCE(paid_amount, 0) - COALESCE(returned_amount, 0)
        ) > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_open := round(
        v_purchase.total
        - COALESCE(v_purchase.paid_amount, 0)
        - COALESCE(v_purchase.returned_amount, 0),
        2
      );
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.purchases
      SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = v_purchase.id;
      v_remaining := round(v_remaining - v_applied, 2);
    END LOOP;
  END IF;

  INSERT INTO public.treasury_transactions (
    branch_id, organization_id, transaction_type, from_account_id,
    from_branch_id, to_branch_id,
    amount, reference_number, notes, created_by, reference_type, reference_id
  )
  VALUES (
    p_branch_id, v_supplier_org, 'withdrawal', v_source.id,
    v_source.branch_id, NULL,
    round(p_amount, 2), v_number,
    COALESCE(p_notes, 'سداد مورد ' || v_number),
    auth.uid(), 'supplier_payment', v_payment_id
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.supplier_payments
  SET treasury_transaction_id = v_tx_id
  WHERE id = v_payment_id;

  IF v_source.branch_id = p_branch_id THEN
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'ap',
        'debit', round(p_amount, 2),
        'credit', 0,
        'supplier_id', p_supplier_id,
        'note', v_number
      ),
      jsonb_build_object(
        'account_code', v_source_code,
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      p_branch_id,
      'supplier_payment',
      v_payment_id,
      v_number,
      'سداد مورد ' || v_number,
      v_lines
    );
  ELSE
    -- Supplier branch: AP decreases; clearing carries the funding from another treasury.
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'ap',
        'debit', round(p_amount, 2),
        'credit', 0,
        'supplier_id', p_supplier_id,
        'note', v_number
      ),
      jsonb_build_object(
        'account_key', 'treasury_clearing',
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      p_branch_id,
      'supplier_payment',
      v_payment_id,
      v_number,
      'سداد مورد ممول من خزنة أخرى ' || v_number,
      v_lines
    );

    -- Funding branch: clearing receives the debit; actual source treasury is credited.
    v_funding_lines := jsonb_build_array(
      jsonb_build_object(
        'account_key', 'treasury_clearing',
        'debit', round(p_amount, 2),
        'credit', 0,
        'note', v_number
      ),
      jsonb_build_object(
        'account_code', v_source_code,
        'debit', 0,
        'credit', round(p_amount, 2),
        'note', v_number
      )
    );

    PERFORM public._post_journal_entry(
      v_source.branch_id,
      'supplier_payment_funding',
      v_payment_id,
      v_number,
      'تمويل سداد مورد ' || v_number,
      v_funding_lines
    );
  END IF;

  PERFORM public.log_audit_action(
    p_branch_id,
    'supplier_payment_from_treasury',
    'supplier_payment',
    v_payment_id,
    jsonb_build_object(
      'supplier_id', p_supplier_id,
      'amount', round(p_amount, 2),
      'treasury_account_id', v_source.id,
      'treasury_branch_id', v_source.branch_id,
      'treasury_scope', v_source.scope,
      'treasury_transaction_id', v_tx_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'treasury_transaction_id', v_tx_id,
    'treasury_account_id', v_source.id,
    'reference_number', v_number,
    'unapplied', v_remaining
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'TRANSACTION_FAILED',
    'detail', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_supplier_opening_balance(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_opening_balance(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_supplier_opening_balance(uuid,uuid,numeric,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_opening_balance(uuid,uuid,numeric,date,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pay_supplier_from_treasury(uuid,uuid,numeric,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier_from_treasury(uuid,uuid,numeric,uuid,uuid,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
