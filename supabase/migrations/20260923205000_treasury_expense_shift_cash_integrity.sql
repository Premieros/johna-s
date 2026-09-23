BEGIN;

-- Treasury-source integrity for shift cash.
-- Only a branch-scoped branch_cash treasury for the same branch may alter the
-- physical shift drawer. Organization main cash and bank accounts remain real
-- accounting sources but never change shift expected cash.

CREATE OR REPLACE FUNCTION private.treasury_affects_shift_cash(
  p_treasury_account_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.treasury_accounts t
    WHERE t.id = p_treasury_account_id
      AND t.branch_id = p_branch_id
      AND t.is_active
      AND COALESCE(t.scope, 'branch') = 'branch'
      AND COALESCE(
        t.kind,
        CASE WHEN t.account_type = 'bank' THEN 'bank' ELSE 'branch_cash' END
      ) = 'branch_cash'
  );
$function$;

REVOKE ALL ON FUNCTION private.treasury_affects_shift_cash(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.treasury_affects_shift_cash(uuid, uuid) TO service_role, postgres;

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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense_id uuid;
  v_entry_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_expense_account public.chart_of_accounts%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_lines jsonb;
  v_affects_shift_cash boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active) THEN RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND'); END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.manage') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.manage'); END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT'); END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND branch_id = p_branch_id FOR UPDATE;
  IF v_shift.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND'); END IF;
  IF v_shift.status <> 'open' THEN RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_OPEN'); END IF;

  SELECT * INTO v_expense_account FROM public.chart_of_accounts
  WHERE id = p_expense_account_id AND branch_id = p_branch_id AND is_active;
  IF v_expense_account.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_ACCOUNT_REQUIRED'); END IF;

  SELECT * INTO v_treasury FROM public.treasury_accounts
  WHERE id = p_treasury_account_id AND branch_id = p_branch_id AND is_active;
  IF v_treasury.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED'); END IF;

  v_affects_shift_cash := private.treasury_affects_shift_cash(p_treasury_account_id, p_branch_id);

  SELECT id INTO v_expense_id FROM public.expenses
  WHERE branch_id = p_branch_id AND idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF v_expense_id IS NOT NULL THEN
    SELECT id INTO v_entry_id FROM public.journal_entries WHERE reference_type = 'expense' AND reference_id = v_expense_id;
    RETURN jsonb_build_object(
      'success', true,
      'already_posted', true,
      'expense_id', v_expense_id,
      'journal_entry_id', v_entry_id,
      'affects_shift_cash', v_affects_shift_cash
    );
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
    jsonb_build_object('account_code', v_expense_account.code, 'debit', round(p_amount, 2), 'credit', 0, 'note', COALESCE(p_description, p_category)),
    jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_treasury.account_id), 'debit', 0, 'credit', round(p_amount, 2), 'note', COALESCE(p_description, p_category))
  );

  v_entry_id := public._post_journal_entry(
    p_branch_id, 'expense', v_expense_id, btrim(p_idempotency_key),
    'Expense: ' || COALESCE(p_category, p_description, 'expense'), v_lines
  );

  IF v_affects_shift_cash THEN
    INSERT INTO public.shift_operations(
      shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by
    ) VALUES (
      p_shift_id, 'expense', round(p_amount, 2), COALESCE(NULLIF(btrim(p_payment_method), ''), 'cash'),
      'expense', v_expense_id, v_uid
    );
  END IF;

  PERFORM public.log_audit_action(
    p_branch_id, 'expense_posted', 'expense', v_expense_id,
    jsonb_build_object(
      'shift_id', p_shift_id,
      'treasury_account_id', p_treasury_account_id,
      'expense_account_id', p_expense_account_id,
      'amount', round(p_amount, 2),
      'affects_shift_cash', v_affects_shift_cash
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'expense_id', v_expense_id,
    'journal_entry_id', v_entry_id,
    'already_posted', false,
    'affects_shift_cash', v_affects_shift_cash
  );
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_expense_id FROM public.expenses WHERE branch_id = p_branch_id AND idempotency_key = btrim(p_idempotency_key);
  SELECT id INTO v_entry_id FROM public.journal_entries WHERE reference_type = 'expense' AND reference_id = v_expense_id;
  RETURN jsonb_build_object(
    'success', true,
    'already_posted', true,
    'expense_id', v_expense_id,
    'journal_entry_id', v_entry_id,
    'affects_shift_cash', private.treasury_affects_shift_cash(p_treasury_account_id, p_branch_id)
  );
WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_POST_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_shift_expense(
  p_expense_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_entry_id uuid;
  v_reversal_entry_id uuid;
  v_lines jsonb;
  v_affects_shift_cash boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.manage') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.manage'); END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'REVERSAL_REASON_REQUIRED'); END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_expense.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_NOT_FOUND'); END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(v_expense.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;

  v_affects_shift_cash := private.treasury_affects_shift_cash(v_expense.treasury_account_id, v_expense.branch_id);

  IF v_expense.status = 'voided' THEN
    SELECT id INTO v_reversal_entry_id FROM public.journal_entries WHERE reference_type = 'expense_reversal' AND reference_id = p_expense_id;
    RETURN jsonb_build_object(
      'success', true,
      'already_reversed', true,
      'expense_id', p_expense_id,
      'journal_entry_id', v_reversal_entry_id,
      'affects_shift_cash', v_affects_shift_cash
    );
  END IF;

  SELECT id INTO v_entry_id FROM public.journal_entries WHERE reference_type = 'expense' AND reference_id = p_expense_id;
  IF v_entry_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_JOURNAL_NOT_FOUND'); END IF;

  SELECT jsonb_build_array(
    jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_expense.account_id), 'debit', 0, 'credit', round(v_expense.amount, 2), 'note', p_reason),
    jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts ta JOIN public.treasury_accounts t ON t.account_id = ta.id WHERE t.id = v_expense.treasury_account_id), 'debit', round(v_expense.amount, 2), 'credit', 0, 'note', p_reason)
  ) INTO v_lines;

  v_reversal_entry_id := public._post_journal_entry(
    v_expense.branch_id, 'expense_reversal', p_expense_id, v_expense.idempotency_key,
    'Expense reversal: ' || p_reason, v_lines
  );

  UPDATE public.expenses
  SET status = 'voided', voided_at = now(), voided_by = v_uid, void_reason = btrim(p_reason)
  WHERE id = p_expense_id AND status = 'posted';

  IF v_affects_shift_cash THEN
    INSERT INTO public.shift_operations(
      shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by
    ) VALUES (
      v_expense.shift_id, 'cash_in', round(v_expense.amount, 2), v_expense.payment_method,
      'expense_reversal', p_expense_id, v_uid
    );
  END IF;

  PERFORM public.log_audit_action(
    v_expense.branch_id, 'expense_reversed', 'expense', p_expense_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'journal_entry_id', v_reversal_entry_id,
      'affects_shift_cash', v_affects_shift_cash
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_reversed', false,
    'expense_id', p_expense_id,
    'journal_entry_id', v_reversal_entry_id,
    'affects_shift_cash', v_affects_shift_cash
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_REVERSAL_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public._compute_shift_expected_cash(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH target_shift AS (
    SELECT
      s.id,
      s.branch_id,
      s.opening_amount,
      s.opened_at,
      COALESCE(s.closed_at, now()) AS effective_closed_at
    FROM public.shifts s
    WHERE s.id = p_shift_id
  ),
  operation_cash AS (
    SELECT COALESCE(sum(
      CASE
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type IN ('sale', 'cash_in')
          THEN op.amount
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type IN ('refund', 'cash_out')
          THEN -op.amount
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type = 'expense'
             AND NOT EXISTS (
               SELECT 1
               FROM public.expenses e
               WHERE e.id = op.reference_id
                 AND e.status = 'posted'
             )
          THEN -op.amount
        ELSE 0
      END
    ), 0) AS amount
    FROM target_shift s
    LEFT JOIN public.shift_operations op
      ON op.shift_id = s.id
  ),
  posted_branch_cash_expenses AS (
    SELECT COALESCE(sum(e.amount), 0) AS amount
    FROM target_shift s
    JOIN public.expenses e
      ON e.branch_id = s.branch_id
     AND e.status = 'posted'
     AND COALESCE(e.payment_method, 'cash') = 'cash'
     AND e.shift_id = s.id
    JOIN public.treasury_accounts t
      ON t.id = e.treasury_account_id
     AND t.branch_id = s.branch_id
     AND COALESCE(t.scope, 'branch') = 'branch'
     AND COALESCE(
       t.kind,
       CASE WHEN t.account_type = 'bank' THEN 'bank' ELSE 'branch_cash' END
     ) = 'branch_cash'
  ),
  cash_purchases AS (
    SELECT COALESCE(sum(
      GREATEST(
        COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0),
        0
      )
    ), 0) AS amount
    FROM target_shift s
    JOIN public.purchases p
      ON p.branch_id = s.branch_id
     AND COALESCE(p.payment_method, 'cash') = 'cash'
     AND COALESCE(p.status, 'completed') IN ('completed', 'returned')
     AND p.created_at >= s.opened_at
     AND p.created_at <= s.effective_closed_at
  )
  SELECT round(
    COALESCE(s.opening_amount, 0)
    + COALESCE(o.amount, 0)
    - COALESCE(e.amount, 0)
    - COALESCE(p.amount, 0),
    2
  )
  FROM target_shift s
  CROSS JOIN operation_cash o
  CROSS JOIN posted_branch_cash_expenses e
  CROSS JOIN cash_purchases p;
$function$;

-- Clean only derivative drawer rows that were incorrectly created for expenses
-- funded from organization main cash or bank. Accounting expense rows and GL
-- journal entries are intentionally preserved.
DELETE FROM public.shift_operations op
USING public.expenses e, public.treasury_accounts t
WHERE op.reference_type = 'expense'
  AND op.reference_id = e.id
  AND t.id = e.treasury_account_id
  AND NOT (
    t.branch_id = e.branch_id
    AND COALESCE(t.scope, 'branch') = 'branch'
    AND COALESCE(
      t.kind,
      CASE WHEN t.account_type = 'bank' THEN 'bank' ELSE 'branch_cash' END
    ) = 'branch_cash'
  );

DELETE FROM public.shift_operations op
USING public.expenses e, public.treasury_accounts t
WHERE op.reference_type = 'expense_reversal'
  AND op.reference_id = e.id
  AND t.id = e.treasury_account_id
  AND NOT (
    t.branch_id = e.branch_id
    AND COALESCE(t.scope, 'branch') = 'branch'
    AND COALESCE(
      t.kind,
      CASE WHEN t.account_type = 'bank' THEN 'bank' ELSE 'branch_cash' END
    ) = 'branch_cash'
  );

REVOKE ALL ON FUNCTION public.post_shift_expense(text, uuid, uuid, text, text, numeric, text, uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_shift_expense(text, uuid, uuid, text, text, numeric, text, uuid, uuid, date, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reverse_shift_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_shift_expense(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._compute_shift_expected_cash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._compute_shift_expected_cash(uuid) TO service_role, postgres;

COMMIT;
