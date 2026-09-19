-- Historical financial reconciliation for Premieros/johna-s.
--
-- SAFETY:
-- - This file is NOT a migration and is never run by normal deploys.
-- - It performs no POS/order/inventory/kitchen/shift/day-close/print mutations.
-- - It aborts unless the caller explicitly sets:
--     SELECT set_config('app.allow_financial_repair', 'yes', true);
-- - Purchase header/item and cross-branch warehouse anomalies are REPORT-ONLY
--   because their correct historical intent cannot be inferred safely.
--
-- Recommended usage:
--   BEGIN;
--   SELECT set_config('app.allow_financial_repair', 'yes', true);
--   \i scripts/db/reconcile-financial-history.sql
--   -- inspect verification result
--   COMMIT; -- only after review
--
-- The script is idempotent: rows with an existing matching journal are skipped.

DO $repair$
DECLARE
  v_expense record;
  v_sale record;
  v_sale_entry uuid;
  v_account uuid;
  v_lines jsonb;
  v_total numeric(14,2);
  v_revenue numeric(14,2);
  v_discount numeric(14,2);
  v_vat numeric(14,2);
  v_cogs numeric(14,2);
  v_ratio numeric(14,6);
  v_revenue_r numeric(14,2);
  v_discount_r numeric(14,2);
  v_vat_r numeric(14,2);
  v_cogs_r numeric(14,2);
  v_collection_key text;
  v_paid_code text;
  v_dr numeric(14,2);
  v_cr numeric(14,2);
  v_diff numeric(14,2);
BEGIN
  IF COALESCE(current_setting('app.allow_financial_repair', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'FINANCIAL_REPAIR_EXPLICIT_FLAG_REQUIRED';
  END IF;

  -- 1) Posted expenses that exist operationally but never received a GL entry.
  FOR v_expense IN
    SELECT e.*
    FROM public.expenses e
    WHERE e.status = 'posted'
      AND NOT EXISTS (
        SELECT 1
        FROM public.journal_entries j
        WHERE j.reference_type = 'expense'
          AND j.reference_id = e.id
      )
    ORDER BY e.created_at, e.id
  LOOP
    v_account := NULL;
    IF v_expense.account_id IS NOT NULL THEN
      SELECT a.id INTO v_account
      FROM public.chart_of_accounts a
      WHERE a.id = v_expense.account_id
        AND a.branch_id = v_expense.branch_id
        AND a.is_active;
    END IF;
    v_account := COALESCE(v_account, public.resolve_account_key(v_expense.branch_id, 'expense_default'));
    IF v_account IS NULL THEN
      RAISE EXCEPTION 'EXPENSE_ACCOUNT_NOT_FOUND for expense %', v_expense.id;
    END IF;

    v_total := round(COALESCE(v_expense.amount, 0) + COALESCE(v_expense.tax_amount, 0), 2);
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_account),
        'debit', round(COALESCE(v_expense.amount, 0), 2),
        'credit', 0,
        'note', COALESCE(v_expense.description, v_expense.category)
      )
    );

    IF COALESCE(v_expense.tax_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', 'vat_receivable',
        'debit', round(v_expense.tax_amount, 2),
        'credit', 0
      );
    END IF;

    v_lines := v_lines || jsonb_build_object(
      'account_key', CASE WHEN COALESCE(v_expense.payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END,
      'debit', 0,
      'credit', v_total,
      'note', COALESCE(v_expense.description, v_expense.category)
    );

    PERFORM public._post_journal_entry(
      v_expense.branch_id,
      'expense',
      v_expense.id,
      NULL,
      'Historical expense reconciliation · ' || COALESCE(v_expense.category, 'expense'),
      v_lines
    );
  END LOOP;

  -- 2) Sales already carrying refunded_amount but missing the accounting reversal.
  --    This only posts the missing journal. It never re-runs inventory restoration,
  --    payment mutation, approval, shift operations, or sale/item refund mutation.
  FOR v_sale IN
    SELECT s.*
    FROM public.sales s
    WHERE COALESCE(s.refunded_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.journal_entries j
        WHERE j.reference_type = 'refund'
          AND (
            j.reference_id = s.id
            OR (j.reference_id IS NULL AND j.reference_number = s.invoice_number)
          )
      )
    ORDER BY s.created_at, s.id
  LOOP
    SELECT j.id INTO v_sale_entry
    FROM public.journal_entries j
    WHERE j.branch_id = v_sale.branch_id
      AND j.reference_type = 'sale'
      AND j.reference_id = v_sale.id
    ORDER BY j.created_at, j.id
    LIMIT 1;

    IF v_sale_entry IS NULL THEN
      RAISE EXCEPTION 'ORIGINAL_SALE_JOURNAL_NOT_FOUND for sale %', v_sale.id;
    END IF;

    SELECT
      round(COALESCE(SUM(CASE WHEN a.id IN (m.revenue_id, m.other_income_id) THEN l.credit - l.debit ELSE 0 END), 0), 2),
      round(COALESCE(SUM(CASE WHEN a.id = m.discount_id THEN l.debit - l.credit ELSE 0 END), 0), 2),
      round(COALESCE(SUM(CASE WHEN a.id = m.vat_id THEN l.credit - l.debit ELSE 0 END), 0), 2),
      round(COALESCE(SUM(CASE WHEN a.id = m.cogs_id THEN l.debit - l.credit ELSE 0 END), 0), 2)
    INTO v_revenue, v_discount, v_vat, v_cogs
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts a ON a.id = l.account_id
    CROSS JOIN (
      SELECT
        public.resolve_account_key(v_sale.branch_id, 'revenue') AS revenue_id,
        public.resolve_account_key(v_sale.branch_id, 'other_income') AS other_income_id,
        public.resolve_account_key(v_sale.branch_id, 'discount_given') AS discount_id,
        public.resolve_account_key(v_sale.branch_id, 'vat_payable') AS vat_id,
        public.resolve_account_key(v_sale.branch_id, 'cogs') AS cogs_id
    ) m
    WHERE l.journal_entry_id = v_sale_entry;

    v_ratio := round(COALESCE(v_sale.refunded_amount, 0) / GREATEST(COALESCE(v_sale.total, 0), 1), 6);
    v_revenue_r := round(v_revenue * v_ratio, 2);
    v_discount_r := round(v_discount * v_ratio, 2);
    v_vat_r := round(v_vat * v_ratio, 2);
    v_cogs_r := round(v_cogs * v_ratio, 2);

    SELECT a.code INTO v_paid_code
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts a ON a.id = l.account_id
    WHERE l.journal_entry_id = v_sale_entry
      AND l.debit > 0
      AND a.code IN ('1000', '1010', '1100')
    ORDER BY CASE a.code WHEN '1000' THEN 1 WHEN '1010' THEN 2 ELSE 3 END
    LIMIT 1;

    v_collection_key := CASE v_paid_code WHEN '1010' THEN 'bank' WHEN '1100' THEN 'ar' ELSE 'cash' END;
    v_lines := '[]'::jsonb;
    v_dr := 0;
    v_cr := 0;

    IF v_revenue_r > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'revenue', 'debit', v_revenue_r, 'credit', 0);
      v_dr := v_dr + v_revenue_r;
    END IF;
    IF v_discount_r > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_discount_r);
      v_cr := v_cr + v_discount_r;
    END IF;
    IF v_vat_r > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'vat_payable', 'debit', v_vat_r, 'credit', 0);
      v_dr := v_dr + v_vat_r;
    END IF;
    IF v_cogs_r > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'inventory_fg', 'debit', v_cogs_r, 'credit', 0);
      v_lines := v_lines || jsonb_build_object('account_key', 'cogs', 'debit', 0, 'credit', v_cogs_r);
      v_dr := v_dr + v_cogs_r;
      v_cr := v_cr + v_cogs_r;
    END IF;

    IF COALESCE(v_sale.refunded_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_object(
        'account_key', v_collection_key,
        'debit', 0,
        'credit', round(v_sale.refunded_amount, 2),
        'customer_id', CASE WHEN v_collection_key = 'ar' THEN v_sale.customer_id ELSE NULL END,
        'note', 'Historical refund reconciliation · ' || v_sale.invoice_number
      );
      v_cr := v_cr + round(v_sale.refunded_amount, 2);
    END IF;

    v_diff := round(v_dr - v_cr, 2);
    IF v_diff > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', 0, 'credit', v_diff);
    ELSIF v_diff < 0 THEN
      v_lines := v_lines || jsonb_build_object('account_key', 'discount_given', 'debit', -v_diff, 'credit', 0);
    END IF;

    PERFORM public._post_journal_entry(
      v_sale.branch_id,
      'refund',
      NULL,
      v_sale.invoice_number,
      'Historical refund reconciliation · ' || v_sale.invoice_number,
      v_lines
    );
  END LOOP;
END
$repair$;

-- Verification / unresolved exceptions. These SELECTs must be reviewed before COMMIT.
SELECT 'posted_expenses_missing_gl' AS check_name, count(*) AS remaining
FROM public.expenses e
WHERE e.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries j
    WHERE j.reference_type = 'expense' AND j.reference_id = e.id
  )
UNION ALL
SELECT 'refunded_sales_missing_gl', count(*)
FROM public.sales s
WHERE COALESCE(s.refunded_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries j
    WHERE j.reference_type = 'refund'
      AND (j.reference_id = s.id OR (j.reference_id IS NULL AND j.reference_number = s.invoice_number))
  )
UNION ALL
SELECT 'purchase_header_item_mismatch', count(*)
FROM public.purchases p
LEFT JOIN (
  SELECT purchase_id, sum(total) AS item_total
  FROM public.purchase_items
  GROUP BY purchase_id
) x ON x.purchase_id = p.id
WHERE abs(COALESCE(p.subtotal, 0) - COALESCE(x.item_total, 0)) > 0.01
UNION ALL
SELECT 'purchase_cross_branch_warehouse', count(*)
FROM public.purchases p
JOIN public.warehouses w ON w.id = p.warehouse_id
WHERE w.branch_id IS DISTINCT FROM p.branch_id;
