-- Fix runtime error in get_shift_closing_report(uuid):
--   aggregate function calls cannot be nested
--
-- The treasury payload previously called sum(...) inside jsonb_agg(...), which
-- PostgreSQL rejects when that statement is executed. Pre-aggregate each
-- treasury account in a derived table, then JSON-aggregate the derived rows.
-- Public RPC contract, permissions and hardened search_path remain unchanged.

CREATE OR REPLACE FUNCTION public.get_shift_closing_report(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_branch uuid;
  v_gross numeric := 0;
  v_discounts numeric := 0;
  v_returns numeric := 0;
  v_expenses numeric := 0;
  v_net numeric := 0;
  v_expected numeric := 0;
  v_users jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_treasury jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND'); END IF;
  v_branch := v_shift.branch_id;
  IF auth.uid() IS NULL OR (NOT is_pos_admin() AND NOT user_may_access_branch(v_branch)) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;
  IF NOT is_pos_admin() AND NOT can_permission('shifts.report.shift') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'shifts.report.shift'); END IF;

  SELECT COALESCE(sum(s.subtotal), 0), COALESCE(sum(s.discount_amount), 0),
    COALESCE(sum(s.refunded_amount), 0), COALESCE(sum(s.total - COALESCE(s.refunded_amount, 0)), 0)
  INTO v_gross, v_discounts, v_returns, v_net
  FROM public.sales s
  WHERE s.branch_id = v_branch
    AND s.id IN (
      SELECT DISTINCT op.reference_id FROM public.shift_operations op
      WHERE op.shift_id = p_shift_id AND op.reference_type = 'sale'
    );

  SELECT COALESCE(sum(e.amount), 0) INTO v_expenses
  FROM public.expenses e WHERE e.shift_id = p_shift_id AND e.status = 'posted';
  v_net := round(v_net - v_expenses, 2);

  SELECT round(COALESCE(v_shift.opening_amount, 0) + COALESCE(sum(CASE
    WHEN COALESCE(payment_method, 'cash') = 'cash' AND operation_type IN ('sale', 'cash_in') THEN amount
    WHEN COALESCE(payment_method, 'cash') = 'cash' AND operation_type IN ('refund', 'expense', 'cash_out') THEN -amount
    ELSE 0 END), 0), 2)
  INTO v_expected FROM public.shift_operations WHERE shift_id = p_shift_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'count', count, 'total', total) ORDER BY method), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT COALESCE(payment_method, 'cash') AS method, count(*)::int AS count,
      round(sum(CASE WHEN operation_type IN ('refund', 'expense', 'cash_out') THEN -amount ELSE amount END), 2) AS total
    FROM public.shift_operations WHERE shift_id = p_shift_id
      AND operation_type IN ('sale', 'refund', 'expense', 'cash_in', 'cash_out')
    GROUP BY COALESCE(payment_method, 'cash')
  ) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', u.id, 'display_name', COALESCE(u.full_name, u.email),
    'sales_total', x.sales_total, 'invoice_count', x.invoice_count,
    'discounts', x.discounts, 'returns', x.returns, 'expenses', x.expenses,
    'net_contribution', round(x.sales_total - x.returns - x.expenses, 2)
  ) ORDER BY COALESCE(u.full_name, u.email)), '[]'::jsonb) INTO v_users
  FROM (
    WITH sale_attribution AS (
      SELECT DISTINCT ON (op.reference_id) op.reference_id AS sale_id, op.created_by
      FROM public.shift_operations op
      WHERE op.shift_id = p_shift_id AND op.reference_type = 'sale'
      ORDER BY op.reference_id, op.created_at, op.id
    ), user_sales AS (
      SELECT COALESCE(sa.created_by, s.cashier_id) AS user_id,
        sum(s.total) AS sales_total, count(*)::int AS invoice_count,
        sum(s.discount_amount) AS discounts, 0::numeric AS returns, 0::numeric AS expenses
      FROM sale_attribution sa JOIN public.sales s ON s.id = sa.sale_id
      GROUP BY COALESCE(sa.created_by, s.cashier_id)
    ), user_returns AS (
      SELECT op.created_by AS user_id, 0::numeric AS sales_total, 0::int AS invoice_count,
        0::numeric AS discounts, sum(op.amount) AS returns, 0::numeric AS expenses
      FROM public.shift_operations op
      WHERE op.shift_id = p_shift_id AND op.operation_type = 'refund'
      GROUP BY op.created_by
    ), user_expenses AS (
      SELECT e.created_by AS user_id, 0::numeric AS sales_total, 0::int AS invoice_count,
        0::numeric AS discounts, 0::numeric AS returns, sum(e.amount) AS expenses
      FROM public.expenses e WHERE e.shift_id = p_shift_id AND e.status = 'posted'
      GROUP BY e.created_by
    )
    SELECT user_id, round(sum(sales_total), 2) AS sales_total,
      sum(invoice_count)::int AS invoice_count, round(sum(discounts), 2) AS discounts,
      round(sum(returns), 2) AS returns, round(sum(expenses), 2) AS expenses
    FROM (
      SELECT * FROM user_sales
      UNION ALL SELECT * FROM user_returns
      UNION ALL SELECT * FROM user_expenses
    ) totals
    GROUP BY user_id
  ) x
  JOIN public.users u ON u.id = x.user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_id', q.id,
    'account_name', q.account_name,
    'opening_balance', q.opening_balance,
    'gl_balance', q.gl_balance
  ) ORDER BY q.account_name), '[]'::jsonb)
  INTO v_treasury
  FROM (
    SELECT
      t.id,
      t.account_name,
      t.opening_balance,
      round(t.opening_balance + COALESCE(sum(l.debit - l.credit), 0), 2) AS gl_balance
    FROM public.treasury_accounts t
    LEFT JOIN public.journal_entry_lines l ON l.account_id = t.account_id
    WHERE t.branch_id = v_branch
    GROUP BY t.id, t.account_name, t.opening_balance
  ) q;

  RETURN jsonb_build_object(
    'success', true, 'shift_id', p_shift_id, 'branch_id', v_branch,
    'gross_sales', round(v_gross, 2), 'discounts', round(v_discounts, 2),
    'returns', round(v_returns, 2), 'voids', 0, 'expenses', round(v_expenses, 2),
    'net_revenue', v_net, 'expected_cash', v_expected,
    'actual_cash', v_shift.actual_amount, 'difference', v_shift.difference,
    'payment_methods', v_payments, 'users', v_users, 'treasury', v_treasury
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shift_closing_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_closing_report(uuid) TO authenticated, service_role;
