-- Shift/day close and expense-to-treasury GL contract.
-- All financial writes remain server-authoritative and idempotent.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shifts(id),
  ADD COLUMN IF NOT EXISTS treasury_account_id uuid REFERENCES public.treasury_accounts(id),
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_status_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check CHECK (status IN ('posted', 'voided'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_branch_idempotency
  ON public.expenses(branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_shift_status
  ON public.expenses(shift_id, status, expense_date);

CREATE TABLE IF NOT EXISTS public.daily_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'closed' CHECK (status = 'closed'),
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, business_date)
);

ALTER TABLE public.daily_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_closes_select ON public.daily_closes;
CREATE POLICY daily_closes_select ON public.daily_closes
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
DROP POLICY IF EXISTS daily_closes_write ON public.daily_closes;
CREATE POLICY daily_closes_write ON public.daily_closes
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin() OR (can_permission('shifts.day_close') AND branch_id = get_branch_id()));

-- Financial expenses must use the posting RPC. Existing reads remain available
-- through branch RLS, while direct client writes are removed.
DROP POLICY IF EXISTS auth_insert_expenses ON public.expenses;
DROP POLICY IF EXISTS auth_update_expenses ON public.expenses;
DROP POLICY IF EXISTS auth_delete_expenses ON public.expenses;
DROP POLICY IF EXISTS auth_select_expenses ON public.expenses;
CREATE POLICY auth_select_expenses ON public.expenses
  FOR SELECT TO authenticated
  USING (is_pos_admin() OR branch_id = get_branch_id());
REVOKE INSERT, UPDATE, DELETE ON public.expenses FROM authenticated;

CREATE OR REPLACE FUNCTION public.post_shift_expense(
  p_idempotency_key text,
  p_branch_id uuid,
  p_shift_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_payment_method text,
  p_expense_account_id uuid,
  p_treasury_account_id uuid,
  p_expense_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense_id uuid;
  v_entry_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_expense_account public.chart_of_accounts%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_lines jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.manage');
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id AND branch_id = p_branch_id
  FOR UPDATE;
  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;
  IF v_shift.status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_OPEN');
  END IF;

  SELECT * INTO v_expense_account
  FROM public.chart_of_accounts
  WHERE id = p_expense_account_id AND branch_id = p_branch_id AND is_active;
  IF v_expense_account.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_ACCOUNT_REQUIRED');
  END IF;

  SELECT * INTO v_treasury
  FROM public.treasury_accounts
  WHERE id = p_treasury_account_id AND branch_id = p_branch_id AND is_active;
  IF v_treasury.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED');
  END IF;

  SELECT id INTO v_expense_id
  FROM public.expenses
  WHERE branch_id = p_branch_id AND idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;
  IF v_expense_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE reference_type = 'expense' AND reference_id = v_expense_id;
    RETURN jsonb_build_object('success', true, 'already_posted', true,
      'expense_id', v_expense_id, 'journal_entry_id', v_entry_id);
  END IF;

  INSERT INTO public.expenses(
    category, description, amount, branch_id, payment_method, expense_date,
    notes, created_by, account_id, shift_id, treasury_account_id, idempotency_key, status
  ) VALUES (
    NULLIF(btrim(p_category), ''), p_description, round(p_amount, 2), p_branch_id,
    COALESCE(NULLIF(btrim(p_payment_method), ''), 'cash'), COALESCE(p_expense_date, CURRENT_DATE),
    p_notes, v_uid, p_expense_account_id, p_shift_id, p_treasury_account_id,
    btrim(p_idempotency_key), 'posted'
  ) RETURNING id INTO v_expense_id;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_code', v_expense_account.code,
      'debit', round(p_amount, 2),
      'credit', 0,
      'note', COALESCE(p_description, p_category)
    ),
    jsonb_build_object(
      'account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_treasury.account_id),
      'debit', 0,
      'credit', round(p_amount, 2),
      'note', COALESCE(p_description, p_category)
    )
  );

  v_entry_id := public._post_journal_entry(
    p_branch_id, 'expense', v_expense_id, btrim(p_idempotency_key),
    'Expense: ' || COALESCE(p_category, p_description, 'expense'), v_lines
  );

  INSERT INTO public.shift_operations(
    shift_id, operation_type, amount, payment_method,
    reference_type, reference_id, created_by
  ) VALUES (
    p_shift_id, 'expense', round(p_amount, 2),
    COALESCE(NULLIF(btrim(p_payment_method), ''), 'cash'),
    'expense', v_expense_id, v_uid
  );

  PERFORM public.log_audit_action(
    p_branch_id, 'expense_posted', 'expense', v_expense_id,
    jsonb_build_object('shift_id', p_shift_id, 'treasury_account_id', p_treasury_account_id,
      'expense_account_id', p_expense_account_id, 'amount', round(p_amount, 2))
  );

  RETURN jsonb_build_object('success', true, 'expense_id', v_expense_id,
    'journal_entry_id', v_entry_id, 'already_posted', false);
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_expense_id
  FROM public.expenses
  WHERE branch_id = p_branch_id AND idempotency_key = btrim(p_idempotency_key);
  SELECT id INTO v_entry_id FROM public.journal_entries
  WHERE reference_type = 'expense' AND reference_id = v_expense_id;
  RETURN jsonb_build_object('success', true, 'already_posted', true,
    'expense_id', v_expense_id, 'journal_entry_id', v_entry_id);
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_POST_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_shift_expense(
  p_expense_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_entry_id uuid;
  v_reversal_entry_id uuid;
  v_lines jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.manage');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'REVERSAL_REASON_REQUIRED');
  END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_expense.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_NOT_FOUND');
  END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(v_expense.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_expense.status = 'voided' THEN
    SELECT id INTO v_reversal_entry_id
    FROM public.journal_entries
    WHERE reference_type = 'expense_reversal' AND reference_id = p_expense_id;
    RETURN jsonb_build_object('success', true, 'already_reversed', true,
      'expense_id', p_expense_id, 'journal_entry_id', v_reversal_entry_id);
  END IF;

  SELECT id INTO v_entry_id FROM public.journal_entries
  WHERE reference_type = 'expense' AND reference_id = p_expense_id;
  IF v_entry_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_JOURNAL_NOT_FOUND');
  END IF;

  SELECT jsonb_build_array(
    jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_expense.account_id),
      'debit', 0, 'credit', round(v_expense.amount, 2), 'note', p_reason),
    jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts ta
      JOIN public.treasury_accounts t ON t.account_id = ta.id
      WHERE t.id = v_expense.treasury_account_id),
      'debit', round(v_expense.amount, 2), 'credit', 0, 'note', p_reason)
  ) INTO v_lines;

  v_reversal_entry_id := public._post_journal_entry(
    v_expense.branch_id, 'expense_reversal', p_expense_id, v_expense.idempotency_key,
    'Expense reversal: ' || p_reason, v_lines
  );

  UPDATE public.expenses
  SET status = 'voided', voided_at = now(), voided_by = v_uid, void_reason = btrim(p_reason)
  WHERE id = p_expense_id AND status = 'posted';

  INSERT INTO public.shift_operations(
    shift_id, operation_type, amount, payment_method,
    reference_type, reference_id, created_by
  ) VALUES (
    v_expense.shift_id, 'cash_in', round(v_expense.amount, 2), v_expense.payment_method,
    'expense_reversal', p_expense_id, v_uid
  );

  PERFORM public.log_audit_action(
    v_expense.branch_id, 'expense_reversed', 'expense', p_expense_id,
    jsonb_build_object('reason', btrim(p_reason), 'journal_entry_id', v_reversal_entry_id)
  );

  RETURN jsonb_build_object('success', true, 'already_reversed', false,
    'expense_id', p_expense_id, 'journal_entry_id', v_reversal_entry_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_REVERSAL_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public._finalize_day_close(
  p_branch_id uuid,
  p_business_date date,
  p_closed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.shifts WHERE branch_id = p_branch_id AND status = 'open') THEN
    RETURN jsonb_build_object('success', false, 'error', 'OPEN_SHIFTS_REMAIN');
  END IF;
  INSERT INTO public.daily_closes(branch_id, business_date, closed_by)
  VALUES (p_branch_id, p_business_date, p_closed_by)
  ON CONFLICT (branch_id, business_date) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.daily_closes
    WHERE branch_id = p_branch_id AND business_date = p_business_date;
    RETURN jsonb_build_object('success', true, 'already_closed', true, 'daily_close_id', v_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'already_closed', false, 'daily_close_id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.day_close(
  p_branch_id uuid,
  p_business_date date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT is_pos_admin() AND NOT can_permission('shifts.day_close') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'shifts.day_close');
  END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  RETURN public._finalize_day_close(p_branch_id, COALESCE(p_business_date, CURRENT_DATE), auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_shift_closing_report(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  IF auth.uid() IS NULL OR (NOT is_pos_admin() AND NOT user_may_access_branch(v_branch)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT is_pos_admin() AND NOT can_permission('shifts.report.shift') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'shifts.report.shift');
  END IF;

  SELECT COALESCE(sum(s.subtotal), 0), COALESCE(sum(s.discount_amount), 0),
    COALESCE(sum(s.refunded_amount), 0), COALESCE(sum(s.total - COALESCE(s.refunded_amount, 0)), 0)
  INTO v_gross, v_discounts, v_returns, v_net
  FROM public.sales s
  WHERE s.branch_id = v_branch
    AND s.id IN (
      SELECT DISTINCT op.reference_id
      FROM public.shift_operations op
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'count', count, 'total', total)
    ORDER BY method), '[]'::jsonb) INTO v_payments
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
  ) ORDER BY display_name), '[]'::jsonb) INTO v_users
  FROM (
    WITH sale_attribution AS (
      SELECT DISTINCT ON (op.reference_id)
        op.reference_id AS sale_id, op.created_by
      FROM public.shift_operations op
      WHERE op.shift_id = p_shift_id AND op.reference_type = 'sale'
      ORDER BY op.reference_id, op.created_at, op.id
    ), user_sales AS (
      SELECT COALESCE(sa.created_by, s.cashier_id) AS user_id,
        sum(s.total) AS sales_total,
        count(*)::int AS invoice_count,
        sum(s.discount_amount) AS discounts,
        0::numeric AS returns,
        0::numeric AS expenses
      FROM sale_attribution sa
      JOIN public.sales s ON s.id = sa.sale_id
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
      FROM public.expenses e
      WHERE e.shift_id = p_shift_id AND e.status = 'posted'
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('account_id', t.id, 'account_name', t.account_name,
    'opening_balance', t.opening_balance, 'gl_balance', round(t.opening_balance + COALESCE(sum(l.debit - l.credit), 0), 2))
    ORDER BY t.account_name), '[]'::jsonb) INTO v_treasury
  FROM public.treasury_accounts t
  LEFT JOIN public.journal_entry_lines l ON l.account_id = t.account_id
  WHERE t.branch_id = v_branch GROUP BY t.id;

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

-- Replace the previous close implementation with operational guards.
CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id uuid,
  p_actual_amount numeric,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_shift public.shifts%ROWTYPE;
  v_expected numeric(14,2);
  v_diff numeric(14,2);
  v_day jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT is_pos_admin() AND NOT can_permission('shifts.close') THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSE_DENIED', 'permission', 'shifts.close');
  END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_shift.id IS NULL OR (NOT is_pos_admin() AND NOT user_may_access_branch(v_shift.branch_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;
  IF v_shift.status = 'closed' THEN
    RETURN jsonb_build_object('success', true, 'already_closed', true, 'shift_id', p_shift_id,
      'expected', v_shift.expected_amount, 'actual', v_shift.actual_amount, 'difference', v_shift.difference);
  END IF;
  IF NOT is_pos_admin() AND v_shift.cashier_id <> v_uid AND NOT can_permission('shifts.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_YOUR_SHIFT');
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE branch_id = v_shift.branch_id AND status IN ('open', 'held')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'OPEN_ORDERS_REMAIN');
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE branch_id = v_shift.branch_id AND COALESCE(payment_status, 'unpaid') NOT IN ('paid', 'refunded') AND status NOT IN ('completed', 'cancelled')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNSETTLED_PAYMENTS_REMAIN');
  END IF;

  SELECT round(COALESCE(v_shift.opening_amount, 0) + COALESCE(sum(CASE
    WHEN COALESCE(payment_method, 'cash') = 'cash' AND operation_type IN ('sale', 'cash_in') THEN amount
    WHEN COALESCE(payment_method, 'cash') = 'cash' AND operation_type IN ('refund', 'expense', 'cash_out') THEN -amount
    ELSE 0 END), 0), 2)
  INTO v_expected FROM public.shift_operations WHERE shift_id = p_shift_id;
  v_diff := round(COALESCE(p_actual_amount, v_expected) - v_expected, 2);

  UPDATE public.shifts SET status = 'closed', closed_at = now(), expected_amount = v_expected,
    actual_amount = COALESCE(p_actual_amount, v_expected), difference = v_diff,
    notes = COALESCE(p_notes, notes) WHERE id = p_shift_id AND status = 'open';

  UPDATE public.dining_tables t SET status = 'vacant', updated_at = now()
  WHERE t.branch_id = v_shift.branch_id
    AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.table_id = t.id AND o.status IN ('open', 'held'));

  v_day := public._finalize_day_close(v_shift.branch_id, COALESCE(v_shift.opened_at::date, CURRENT_DATE), v_uid);
  RETURN jsonb_build_object('success', true, 'already_closed', false, 'shift_id', p_shift_id,
    'expected', v_expected, 'actual', COALESCE(p_actual_amount, v_expected), 'difference', v_diff,
    'day_close', v_day);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'SHIFT_CLOSE_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_shift_expense(text, uuid, uuid, text, text, numeric, text, uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_shift_expense(text, uuid, uuid, text, text, numeric, text, uuid, uuid, date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_shift_expense(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_shift_expense(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.day_close(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.day_close(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_shift_closing_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_closing_report(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.close_shift(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, numeric, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_expense(uuid, text, text, numeric, numeric, text, uuid, date, text) FROM authenticated;