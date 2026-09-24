BEGIN;

-- Unified reporting truth for sale settlement methods and treasury reconciliation.
-- Goals:
--   * one canonical settlement breakdown for reports and Z/day consumers
--   * never label legacy split rows as "split" when the journal preserves the real cash/bank split
--   * include unpaid credit/employee-credit as receivables instead of silently dropping it
--   * expose an explicit reconciliation report so cash/card/bank disagreements are visible, not hidden
-- Printing is intentionally out of scope.

CREATE OR REPLACE FUNCTION private.report_sale_settlement_lines(p_sale_id uuid)
RETURNS TABLE(
  method text,
  amount numeric,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_net_sale numeric(14,2) := 0;
  v_collected numeric(14,2) := 0;
  v_method text;
BEGIN
  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id;

  IF v_sale.id IS NULL OR COALESCE(v_sale.is_archived,false) THEN
    RETURN;
  END IF;

  v_net_sale := round(GREATEST(COALESCE(v_sale.total,0) - COALESCE(v_sale.refunded_amount,0),0),2);

  IF EXISTS (SELECT 1 FROM public.sale_payments sp WHERE sp.sale_id=v_sale.id) THEN
    RETURN QUERY
    SELECT
      lower(btrim(COALESCE(sp.payment_method,'other'))) AS method,
      round(GREATEST(COALESCE(sp.amount,0)-COALESCE(sp.refunded_amount,0),0),2) AS amount,
      'sale_payments'::text AS source
    FROM public.sale_payments sp
    WHERE sp.sale_id=v_sale.id
      AND GREATEST(COALESCE(sp.amount,0)-COALESCE(sp.refunded_amount,0),0) > 0;

    SELECT round(COALESCE(sum(GREATEST(COALESCE(sp.amount,0)-COALESCE(sp.refunded_amount,0),0)),0),2)
      INTO v_collected
    FROM public.sale_payments sp
    WHERE sp.sale_id=v_sale.id;

  ELSIF lower(btrim(COALESCE(v_sale.payment_method,'')))='split' THEN
    -- Legacy imported split sale with no sale_payments rows:
    -- recover the actual collection mix from the immutable sale/refund journals.
    RETURN QUERY
    WITH movement AS (
      SELECT
        CASE
          WHEN COALESCE(t.kind,CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END)='branch_cash'
            THEN 'cash'
          WHEN COALESCE(t.kind,CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END)='bank'
            THEN 'bank_legacy'
          ELSE NULL
        END AS method,
        round(sum(l.debit-l.credit),2) AS amount
      FROM public.journal_entries je
      JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
      JOIN public.treasury_accounts t
        ON t.account_id=l.account_id
       AND t.branch_id=v_sale.branch_id
       AND t.is_active
      WHERE (
        (je.reference_type='sale' AND je.reference_id=v_sale.id)
        OR
        (je.reference_type='refund' AND je.reference_number=v_sale.invoice_number)
      )
      GROUP BY 1
    )
    SELECT movement.method, movement.amount, 'journal_legacy_split'::text
    FROM movement
    WHERE movement.method IS NOT NULL
      AND movement.amount > 0;

    SELECT round(COALESCE(sum(x.amount),0),2)
      INTO v_collected
    FROM (
      SELECT round(sum(l.debit-l.credit),2) AS amount
      FROM public.journal_entries je
      JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
      JOIN public.treasury_accounts t
        ON t.account_id=l.account_id
       AND t.branch_id=v_sale.branch_id
       AND t.is_active
      WHERE (
        (je.reference_type='sale' AND je.reference_id=v_sale.id)
        OR
        (je.reference_type='refund' AND je.reference_number=v_sale.invoice_number)
      )
        AND COALESCE(t.kind,CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END)
            IN ('branch_cash','bank')
      GROUP BY l.account_id
    ) x;

  ELSE
    v_collected := round(GREATEST(COALESCE(v_sale.paid_amount,0)-COALESCE(v_sale.refunded_amount,0),0),2);
    v_method := lower(btrim(COALESCE(v_sale.payment_method,'cash')));
    IF v_collected > 0 THEN
      method := CASE
        WHEN v_method IN ('cash','card','transfer') THEN v_method
        WHEN v_method IN ('bank','bank_transfer','instapay','wallet') THEN 'transfer'
        ELSE v_method
      END;
      amount := v_collected;
      source := 'sale_header';
      RETURN NEXT;
    END IF;
  END IF;

  -- Whatever portion of the net sale is not collected is a receivable, not bank.
  IF v_net_sale - v_collected > 0.009 THEN
    method := CASE
      WHEN lower(btrim(COALESCE(v_sale.payment_method,'')))='employee_credit' THEN 'employee_credit'
      ELSE 'credit'
    END;
    amount := round(v_net_sale-v_collected,2);
    source := 'receivable';
    RETURN NEXT;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.report_sale_settlement_lines(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.report_sale_settlement_lines(uuid)
  TO service_role,postgres;

CREATE OR REPLACE FUNCTION public.get_sales_by_payment_report(
  p_branch_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_payment_method text DEFAULT NULL,
  p_order_type text DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_rows jsonb;
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin()
     AND NOT public.can_permission('reports.view')
     AND NOT public.can_permission('reports.financial') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'branch_id',q.branch_id,
    'method',q.method,
    'invoice_count',q.invoice_count,
    'sales_total',q.sales_total,
    'source_quality',q.source_quality
  ) ORDER BY q.sales_total DESC,q.method),'[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      s.branch_id,
      st.method,
      count(DISTINCT s.id)::int AS invoice_count,
      round(sum(st.amount),2) AS sales_total,
      CASE
        WHEN bool_or(st.source='journal_legacy_split') THEN 'legacy_journal_fallback'
        WHEN bool_or(st.source='receivable') THEN 'receivable'
        ELSE 'canonical'
      END AS source_quality
    FROM public.sales s
    CROSS JOIN LATERAL private.report_sale_settlement_lines(s.id) st
    WHERE s.branch_id=p_branch_id
      AND COALESCE(s.is_archived,false)=false
      AND s.created_at>=p_from
      AND s.created_at<p_to
      AND (p_payment_method IS NULL OR st.method=p_payment_method)
      AND (p_order_type IS NULL OR s.order_type=p_order_type)
      AND (p_warehouse_id IS NULL OR s.warehouse_id=p_warehouse_id)
      AND (p_cashier_id IS NULL OR s.cashier_id=p_cashier_id)
      AND (p_status IS NULL OR s.status=p_status)
    GROUP BY s.branch_id,st.method
  ) q;

  SELECT jsonb_build_object(
    'invoice_count',count(DISTINCT s.id)::int,
    'sales_total',round(COALESCE(sum(st.amount),0),2)
  )
  INTO v_summary
  FROM public.sales s
  CROSS JOIN LATERAL private.report_sale_settlement_lines(s.id) st
  WHERE s.branch_id=p_branch_id
    AND COALESCE(s.is_archived,false)=false
    AND s.created_at>=p_from
    AND s.created_at<p_to
    AND (p_payment_method IS NULL OR st.method=p_payment_method)
    AND (p_order_type IS NULL OR s.order_type=p_order_type)
    AND (p_warehouse_id IS NULL OR s.warehouse_id=p_warehouse_id)
    AND (p_cashier_id IS NULL OR s.cashier_id=p_cashier_id)
    AND (p_status IS NULL OR s.status=p_status);

  RETURN jsonb_build_object('success',true,'summary',v_summary,'rows',v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sales_by_payment_report(uuid,timestamptz,timestamptz,text,text,uuid,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_payment_report(uuid,timestamptz,timestamptz,text,text,uuid,uuid,text)
  TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_financial_reconciliation_report(
  p_branch_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_rows jsonb;
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('reports.financial') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','reports.financial');
  END IF;

  WITH scoped_sales AS MATERIALIZED (
    SELECT s.*
    FROM public.sales s
    WHERE s.branch_id=p_branch_id
      AND COALESCE(s.is_archived,false)=false
      AND s.created_at>=p_from
      AND s.created_at<p_to
  ),
  settlement AS MATERIALIZED (
    SELECT
      s.id sale_id,
      round(COALESCE(sum(st.amount) FILTER (WHERE st.method='cash'),0),2) cash_amount,
      round(COALESCE(sum(st.amount) FILTER (WHERE st.method='card'),0),2) card_amount,
      round(COALESCE(sum(st.amount) FILTER (WHERE st.method='transfer'),0),2) transfer_amount,
      round(COALESCE(sum(st.amount) FILTER (WHERE st.method='bank_legacy'),0),2) legacy_bank_amount,
      round(COALESCE(sum(st.amount) FILTER (WHERE st.method IN ('credit','employee_credit')),0),2) credit_amount,
      bool_or(st.source='journal_legacy_split') legacy_fallback
    FROM scoped_sales s
    LEFT JOIN LATERAL private.report_sale_settlement_lines(s.id) st ON true
    GROUP BY s.id
  ),
  gl AS MATERIALIZED (
    SELECT
      s.id sale_id,
      round(COALESCE(sum(CASE
        WHEN COALESCE(t.kind,CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END)='branch_cash'
          THEN l.debit-l.credit ELSE 0 END),0),2) cash_gl,
      round(COALESCE(sum(CASE
        WHEN COALESCE(t.kind,CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END)='bank'
          THEN l.debit-l.credit ELSE 0 END),0),2) bank_gl
    FROM scoped_sales s
    LEFT JOIN public.journal_entries je
      ON (
        (je.reference_type='sale' AND je.reference_id=s.id)
        OR
        (je.reference_type='refund' AND je.reference_number=s.invoice_number)
      )
    LEFT JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
    LEFT JOIN public.treasury_accounts t
      ON t.account_id=l.account_id
     AND t.branch_id=s.branch_id
     AND t.is_active
    GROUP BY s.id
  ),
  rows AS MATERIALIZED (
    SELECT
      s.id sale_id,
      s.invoice_number,
      s.created_at,
      s.status,
      round(GREATEST(COALESCE(s.total,0)-COALESCE(s.refunded_amount,0),0),2) net_sale,
      COALESCE(st.cash_amount,0) cash_amount,
      COALESCE(st.card_amount,0) card_amount,
      COALESCE(st.transfer_amount,0) transfer_amount,
      COALESCE(st.legacy_bank_amount,0) legacy_bank_amount,
      COALESCE(st.credit_amount,0) credit_amount,
      COALESCE(g.cash_gl,0) cash_gl,
      COALESCE(g.bank_gl,0) bank_gl,
      round(COALESCE(g.cash_gl,0)-COALESCE(st.cash_amount,0),2) cash_diff,
      round(
        COALESCE(g.bank_gl,0)
        -(COALESCE(st.card_amount,0)+COALESCE(st.transfer_amount,0)+COALESCE(st.legacy_bank_amount,0)),
        2
      ) bank_diff,
      COALESCE(st.legacy_fallback,false) legacy_fallback
    FROM scoped_sales s
    LEFT JOIN settlement st ON st.sale_id=s.id
    LEFT JOIN gl g ON g.sale_id=s.id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'sale_id',r.sale_id,
      'invoice_number',r.invoice_number,
      'created_at',r.created_at,
      'status',r.status,
      'net_sale',r.net_sale,
      'cash',r.cash_amount,
      'card',r.card_amount,
      'transfer',r.transfer_amount,
      'legacy_bank',r.legacy_bank_amount,
      'credit',r.credit_amount,
      'cash_gl',r.cash_gl,
      'bank_gl',r.bank_gl,
      'cash_diff',r.cash_diff,
      'bank_diff',r.bank_diff,
      'reconciliation_status',CASE
        WHEN abs(r.cash_diff)>0.009 OR abs(r.bank_diff)>0.009 THEN 'mismatch'
        WHEN r.legacy_fallback THEN 'matched_legacy'
        ELSE 'matched'
      END
    ) ORDER BY r.created_at,r.invoice_number),'[]'::jsonb),
    jsonb_build_object(
      'invoice_count',count(*)::int,
      'net_sales',round(COALESCE(sum(r.net_sale),0),2),
      'cash_sales',round(COALESCE(sum(r.cash_amount),0),2),
      'card_sales',round(COALESCE(sum(r.card_amount),0),2),
      'transfer_sales',round(COALESCE(sum(r.transfer_amount),0),2),
      'legacy_bank_sales',round(COALESCE(sum(r.legacy_bank_amount),0),2),
      'credit_sales',round(COALESCE(sum(r.credit_amount),0),2),
      'cash_gl',round(COALESCE(sum(r.cash_gl),0),2),
      'bank_gl',round(COALESCE(sum(r.bank_gl),0),2),
      'cash_difference',round(COALESCE(sum(r.cash_diff),0),2),
      'bank_difference',round(COALESCE(sum(r.bank_diff),0),2),
      'mismatch_count',count(*) FILTER (WHERE abs(r.cash_diff)>0.009 OR abs(r.bank_diff)>0.009),
      'legacy_fallback_count',count(*) FILTER (WHERE r.legacy_fallback)
    )
  INTO v_rows,v_summary
  FROM rows r;

  RETURN jsonb_build_object('success',true,'summary',v_summary,'rows',v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_financial_reconciliation_report(uuid,timestamptz,timestamptz)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_financial_reconciliation_report(uuid,timestamptz,timestamptz)
  TO authenticated,service_role;

-- Shift tender report now uses the same settlement source as sales-by-payment.
CREATE OR REPLACE FUNCTION public.get_shift_sale_tenders(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_sales jsonb:='[]'::jsonb;
  v_methods jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id;
  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','SHIFT_NOT_FOUND');
  END IF;
  IF auth.uid() IS NULL OR (NOT public.is_pos_admin() AND NOT public.user_may_access_branch(v_shift.branch_id)) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','shifts.report.shift');
  END IF;

  WITH sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id
      AND op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  ),
  tender_rows AS (
    SELECT s.id sale_id,s.invoice_number,st.method,st.amount,st.source
    FROM sale_ids x
    JOIN public.sales s ON s.id=x.sale_id
    CROSS JOIN LATERAL private.report_sale_settlement_lines(s.id) st
    WHERE st.amount>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',q.sale_id,'invoice_number',q.invoice_number,'payments',q.payments
  ) ORDER BY q.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM (
    SELECT sale_id,invoice_number,
           jsonb_agg(jsonb_build_object(
             'method',method,'amount',amount,'source',source
           ) ORDER BY method) payments
    FROM tender_rows
    GROUP BY sale_id,invoice_number
  ) q;

  WITH sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    WHERE op.shift_id=p_shift_id
      AND op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  ),
  tender_rows AS (
    SELECT s.id sale_id,st.method,st.amount
    FROM sale_ids x
    JOIN public.sales s ON s.id=x.sale_id
    CROSS JOIN LATERAL private.report_sale_settlement_lines(s.id) st
    WHERE st.amount>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,'count',q.invoice_count,'total',q.total
  ) ORDER BY q.method),'[]'::jsonb)
  INTO v_methods
  FROM (
    SELECT method,count(DISTINCT sale_id)::int invoice_count,round(sum(amount),2) total
    FROM tender_rows
    GROUP BY method
  ) q;

  RETURN jsonb_build_object('success',true,'sales',v_sales,'payment_methods',v_methods);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_sale_tenders(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_shift_sale_tenders(uuid) TO authenticated,service_role;


-- Shift expected cash uses the same canonical settlement truth as reports.
CREATE OR REPLACE FUNCTION public._compute_shift_expected_cash(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  WITH target_shift AS (
    SELECT
      s.id,
      s.branch_id,
      s.opening_amount,
      s.opened_at,
      COALESCE(s.closed_at,now()) effective_closed_at
    FROM public.shifts s
    WHERE s.id=p_shift_id
  ),
  sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    JOIN target_shift s ON s.id=op.shift_id
    WHERE op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  ),
  canonical_cash_sales AS (
    SELECT COALESCE(sum(st.amount),0) amount
    FROM sale_ids x
    CROSS JOIN LATERAL private.report_sale_settlement_lines(x.sale_id) st
    WHERE st.method='cash'
  ),
  cash_adjustments AS (
    SELECT COALESCE(sum(
      CASE
        WHEN COALESCE(op.payment_method,'cash')='cash' AND op.operation_type='cash_in'
          THEN op.amount
        WHEN COALESCE(op.payment_method,'cash')='cash' AND op.operation_type='cash_out'
          THEN -op.amount
        WHEN COALESCE(op.payment_method,'cash')='cash'
             AND op.operation_type='expense'
             AND NOT EXISTS (
               SELECT 1
               FROM public.expenses e
               WHERE e.id=op.reference_id
                 AND e.status='posted'
             )
          THEN -op.amount
        ELSE 0
      END
    ),0) amount
    FROM target_shift s
    LEFT JOIN public.shift_operations op ON op.shift_id=s.id
  ),
  posted_branch_cash_expenses AS (
    SELECT COALESCE(sum(e.amount),0) amount
    FROM target_shift s
    JOIN public.expenses e
      ON e.branch_id=s.branch_id
     AND e.status='posted'
     AND COALESCE(e.payment_method,'cash')='cash'
     AND e.shift_id=s.id
    JOIN public.treasury_accounts t
      ON t.id=e.treasury_account_id
     AND t.branch_id=s.branch_id
     AND COALESCE(t.scope,'branch')='branch'
     AND COALESCE(
       t.kind,
       CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END
     )='branch_cash'
  ),
  cash_purchases AS (
    SELECT COALESCE(sum(
      GREATEST(COALESCE(p.paid_amount,0)-COALESCE(p.returned_amount,0),0)
    ),0) amount
    FROM target_shift s
    JOIN public.purchases p
      ON p.branch_id=s.branch_id
     AND COALESCE(p.payment_method,'cash')='cash'
     AND COALESCE(p.status,'completed') IN ('completed','returned')
     AND p.created_at>=s.opened_at
     AND p.created_at<=s.effective_closed_at
  )
  SELECT round(
    COALESCE(s.opening_amount,0)
    +COALESCE(cs.amount,0)
    +COALESCE(a.amount,0)
    -COALESCE(e.amount,0)
    -COALESCE(p.amount,0),
    2
  )
  FROM target_shift s
  CROSS JOIN canonical_cash_sales cs
  CROSS JOIN cash_adjustments a
  CROSS JOIN posted_branch_cash_expenses e
  CROSS JOIN cash_purchases p;
$function$;

REVOKE ALL ON FUNCTION public._compute_shift_expected_cash(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._compute_shift_expected_cash(uuid)
  TO service_role,postgres;

-- Day close payment details + payment totals use the exact same settlement helper.
-- Rebuild from the latest canonical day-close definition instead of fragile
-- pg_get_functiondef string matching, preserving rollover/owner/report-window logic.
CREATE OR REPLACE FUNCTION public._build_day_closing_report(p_branch_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window jsonb:=public._resolve_business_day_window(p_branch_id,p_business_date);
  v_start timestamptz:=(v_window->>'start_at')::timestamptz;
  v_end timestamptz:=(v_window->>'end_at')::timestamptz;
  v_mode text:=COALESCE(v_window->>'mode','fixed_time');
  v_branch_name text;
  v_sales jsonb:='[]'::jsonb;
  v_expenses jsonb:='[]'::jsonb;
  v_purchases jsonb:='[]'::jsonb;
  v_shifts jsonb:='[]'::jsonb;
  v_users jsonb:='[]'::jsonb;
  v_payments jsonb:='[]'::jsonb;
  v_gross numeric:=0; v_discounts numeric:=0; v_taxes numeric:=0; v_returns numeric:=0;
  v_net_sales numeric:=0; v_expense_total numeric:=0; v_cash_purchases numeric:=0;
  v_cash_sales numeric:=0; v_cash_expenses numeric:=0;
  v_active_shift public.shifts%ROWTYPE;
  v_start_time time:='00:00';
  v_active_business_date date;
BEGIN
  SELECT COALESCE(b.name,b.name_en,'-') INTO v_branch_name
  FROM public.branches b WHERE b.id=p_branch_id;

  -- Live workday = currently open shift, for both fixed_time and shift_span.
  -- Historical/final day close remains on the canonical configured window
  -- because this override disappears as soon as no shift is open.
  SELECT * INTO v_active_shift
  FROM public.shifts s
  WHERE s.branch_id=p_branch_id AND s.status='open'
  ORDER BY s.opened_at DESC,s.id DESC
  LIMIT 1;

  IF v_active_shift.id IS NOT NULL THEN
    SELECT COALESCE(bs.business_day_start,'00:00'::time)
    INTO v_start_time
    FROM public.branch_settings bs
    WHERE bs.branch_id=p_branch_id;

    v_active_business_date := (v_active_shift.opened_at AT TIME ZONE 'Africa/Cairo')::date;
    IF (v_active_shift.opened_at AT TIME ZONE 'Africa/Cairo')::time < v_start_time THEN
      v_active_business_date := v_active_business_date - 1;
    END IF;

    IF v_active_business_date=p_business_date THEN
      v_start := v_active_shift.opened_at;
      v_end := now();
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'invoice_number',s.invoice_number,'user_id',s.cashier_id,
    'user_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',s.subtotal,'discount_amount',s.discount_amount,'tax_amount',s.tax_amount,'total',s.total,
    'paid_amount',s.paid_amount,'refunded_amount',COALESCE(s.refunded_amount,0),
    'payment_method',s.payment_method,
    'payments',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'method',st.method,
        'amount',round(st.amount,2),
        'source',st.source
      ) ORDER BY st.method)
      FROM private.report_sale_settlement_lines(s.id) st
      WHERE st.amount>0
    ),'[]'::jsonb),
    'order_type',s.order_type,'status',s.status,'created_at',s.created_at
  ) ORDER BY s.created_at,s.invoice_number),'[]'::jsonb)
  INTO v_sales
  FROM public.sales s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id
    AND COALESCE(s.is_archived,false)=false
    AND s.created_at>=v_start
    AND s.created_at<=v_end;

  SELECT
    COALESCE(sum((x->>'subtotal')::numeric),0),
    COALESCE(sum((x->>'discount_amount')::numeric),0),
    COALESCE(sum((x->>'tax_amount')::numeric),0),
    COALESCE(sum((x->>'refunded_amount')::numeric),0),
    COALESCE(sum((x->>'total')::numeric-(x->>'refunded_amount')::numeric),0)
  INTO v_gross,v_discounts,v_taxes,v_returns,v_net_sales
  FROM jsonb_array_elements(v_sales) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'expense_id',e.id,'category',e.category,'description',e.description,'amount',e.amount,
    'payment_method',COALESCE(e.payment_method,'cash'),'expense_date',e.expense_date,'notes',e.notes,
    'created_at',e.created_at,'created_by',e.created_by,'created_by_name',COALESCE(u.full_name,u.email,'-'),
    'shift_id',e.shift_id
  ) ORDER BY e.created_at,e.id),'[]'::jsonb)
  INTO v_expenses
  FROM public.expenses e
  LEFT JOIN public.users u ON u.id=e.created_by
  WHERE e.branch_id=p_branch_id
    AND e.status='posted'
    AND e.created_at>=v_start
    AND e.created_at<=v_end;

  SELECT
    COALESCE(sum((x->>'amount')::numeric),0),
    COALESCE(sum(CASE WHEN COALESCE(x->>'payment_method','cash')='cash' THEN (x->>'amount')::numeric ELSE 0 END),0)
  INTO v_expense_total,v_cash_expenses
  FROM jsonb_array_elements(v_expenses) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'purchase_id',p.id,'invoice_number',p.invoice_number,'supplier_id',p.supplier_id,
    'supplier_name',COALESCE(sup.name,'-'),'buyer_id',p.buyer_id,'buyer_name',COALESCE(u.full_name,u.email,'-'),
    'subtotal',p.subtotal,'discount_amount',p.discount_amount,'tax_amount',p.tax_amount,'total',p.total,
    'paid_amount',p.paid_amount,'returned_amount',COALESCE(p.returned_amount,0),
    'cash_outflow',GREATEST(COALESCE(p.paid_amount,0)-COALESCE(p.returned_amount,0),0),
    'payment_method',p.payment_method,'status',p.status,'created_at',p.created_at
  ) ORDER BY p.created_at,p.invoice_number),'[]'::jsonb)
  INTO v_purchases
  FROM public.purchases p
  LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id
  LEFT JOIN public.users u ON u.id=p.buyer_id
  WHERE p.branch_id=p_branch_id
    AND COALESCE(p.payment_method,'cash')='cash'
    AND p.created_at>=v_start
    AND p.created_at<=v_end
    AND COALESCE(p.status,'completed') IN ('completed','returned');

  SELECT COALESCE(sum((x->>'cash_outflow')::numeric),0)
  INTO v_cash_purchases
  FROM jsonb_array_elements(v_purchases) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shift_id',s.id,'cashier_id',s.cashier_id,'cashier_name',COALESCE(u.full_name,u.email,'-'),
    'opened_at',s.opened_at,'closed_at',s.closed_at,'opening_amount',s.opening_amount,
    'expected_amount',s.expected_amount,'actual_amount',s.actual_amount,'difference',s.difference,'status',s.status
  ) ORDER BY s.opened_at,s.id),'[]'::jsonb)
  INTO v_shifts
  FROM public.shifts s
  LEFT JOIN public.users u ON u.id=s.cashier_id
  WHERE s.branch_id=p_branch_id
    AND s.opened_at<=v_end
    AND COALESCE(s.closed_at,now())>=v_start;

  WITH sale_rows AS (
    SELECT s.id
    FROM public.sales s
    WHERE s.branch_id=p_branch_id
      AND COALESCE(s.is_archived,false)=false
      AND s.created_at>=v_start AND s.created_at<=v_end
  ),
  tenders AS (
    SELECT sr.id sale_id,st.method,st.amount,st.source
    FROM sale_rows sr
    CROSS JOIN LATERAL private.report_sale_settlement_lines(sr.id) st
    WHERE st.amount>0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method',q.method,
    'invoice_count',q.invoice_count,
    'sales_total',q.sales_total,
    'source_quality',q.source_quality
  ) ORDER BY q.method),'[]'::jsonb),
  COALESCE(sum(CASE WHEN q.method='cash' THEN q.sales_total ELSE 0 END),0)
  INTO v_payments,v_cash_sales
  FROM (
    SELECT
      method,
      count(DISTINCT sale_id)::int invoice_count,
      round(sum(amount),2) sales_total,
      CASE
        WHEN bool_or(source='journal_legacy_split') THEN 'legacy_journal_fallback'
        WHEN bool_or(source='receivable') THEN 'receivable'
        ELSE 'canonical'
      END source_quality
    FROM tenders
    GROUP BY method
  ) q;

  WITH ids AS (
    SELECT DISTINCT id FROM (
      SELECT NULLIF(x->>'user_id','')::uuid id FROM jsonb_array_elements(v_sales) x
      UNION ALL SELECT NULLIF(x->>'created_by','')::uuid FROM jsonb_array_elements(v_expenses) x
      UNION ALL SELECT NULLIF(x->>'buyer_id','')::uuid FROM jsonb_array_elements(v_purchases) x
      UNION ALL SELECT NULLIF(x->>'cashier_id','')::uuid FROM jsonb_array_elements(v_shifts) x
    ) z WHERE id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',u.id,'display_name',COALESCE(u.full_name,u.email,'-'),
    'invoice_count',(SELECT count(*) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),
    'sales_total',COALESCE((SELECT sum((x->>'total')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'discounts',COALESCE((SELECT sum((x->>'discount_amount')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'returns',COALESCE((SELECT sum((x->>'refunded_amount')::numeric) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),0),
    'expenses',COALESCE((SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(v_expenses) x WHERE x->>'created_by'=u.id::text),0),
    'cash_purchases',COALESCE((SELECT sum((x->>'cash_outflow')::numeric) FROM jsonb_array_elements(v_purchases) x WHERE x->>'buyer_id'=u.id::text),0),
    'sales',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_sales) x WHERE x->>'user_id'=u.id::text),
    'expenses_detail',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_expenses) x WHERE x->>'created_by'=u.id::text),
    'cash_purchases_detail',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(v_purchases) x WHERE x->>'buyer_id'=u.id::text)
  ) ORDER BY COALESCE(u.full_name,u.email)),'[]'::jsonb)
  INTO v_users
  FROM ids JOIN public.users u ON u.id=ids.id;

  RETURN jsonb_build_object(
    'success',true,
    'branch_id',p_branch_id,'branch_name',v_branch_name,'business_date',p_business_date,
    'business_day_mode',v_mode,'window_start',v_start,'window_end',v_end,
    'gross_sales',round(v_gross,2),'discounts',round(v_discounts,2),'taxes',round(v_taxes,2),'returns',round(v_returns,2),
    'net_sales',round(v_net_sales,2),'expenses',round(v_expense_total,2),'cash_purchases',round(v_cash_purchases,2),
    'net_after_expenses',round(v_net_sales-v_expense_total,2),
    'net_after_expenses_and_cash_purchases',round(v_net_sales-v_expense_total-v_cash_purchases,2),
    'cash_sales',round(v_cash_sales,2),'cash_expenses',round(v_cash_expenses,2),
    'cash_after_outflows',round(v_cash_sales-v_cash_expenses-v_cash_purchases,2),
    'invoice_count',jsonb_array_length(v_sales),'shift_count',jsonb_array_length(v_shifts),
    'payment_methods',v_payments,'shifts',v_shifts,'sales_details',v_sales,'expense_details',v_expenses,
    'cash_purchase_details',v_purchases,'users',v_users
  );
END;
$function$;


REVOKE ALL ON FUNCTION public._build_day_closing_report(uuid,date)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._build_day_closing_report(uuid,date)
  TO service_role,postgres;

NOTIFY pgrst,'reload schema';
COMMIT;
