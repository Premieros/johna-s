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

  RETURN jsonb_build_object('success',true,'rows',v_rows);
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

NOTIFY pgrst,'reload schema';
COMMIT;
