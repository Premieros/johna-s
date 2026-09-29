BEGIN;

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
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense_id uuid;
  v_entry_id uuid;
  v_funding_entry_id uuid;
  v_shift public.shifts%ROWTYPE;
  v_expense_account public.chart_of_accounts%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_branch_org uuid;
  v_lines jsonb;
  v_funding_lines jsonb;
  v_source_code text;
  v_affects_shift_cash boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active) THEN RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND'); END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.manage') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.manage'); END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT'); END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;

  SELECT organization_id INTO v_branch_org
  FROM public.branches
  WHERE id = p_branch_id AND is_active;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND branch_id = p_branch_id FOR UPDATE;
  IF v_shift.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND'); END IF;
  IF v_shift.status <> 'open' THEN RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_OPEN'); END IF;

  SELECT * INTO v_expense_account FROM public.chart_of_accounts
  WHERE id = p_expense_account_id AND branch_id = p_branch_id AND is_active;
  IF v_expense_account.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_ACCOUNT_REQUIRED'); END IF;

  SELECT * INTO v_treasury FROM public.treasury_accounts
  WHERE id = p_treasury_account_id AND is_active
  FOR UPDATE;
  IF v_treasury.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED'); END IF;

  IF v_treasury.scope = 'organization' THEN
    IF v_branch_org IS NULL OR v_treasury.organization_id IS DISTINCT FROM v_branch_org THEN
      RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ORGANIZATION_MISMATCH');
    END IF;
    IF NOT is_pos_admin()
       AND NOT can_permission('accounting.treasury.main_cash.pay')
       AND NOT can_permission('accounting.treasury.transfer') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'MAIN_TREASURY_PAYMENT_PERMISSION_REQUIRED',
        'permission', 'accounting.treasury.main_cash.pay'
      );
    END IF;
  ELSIF v_treasury.branch_id IS DISTINCT FROM p_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_BRANCH_MISMATCH');
  END IF;

  SELECT code INTO v_source_code
  FROM public.chart_of_accounts
  WHERE id = v_treasury.account_id AND is_active;
  IF v_source_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_MAPPING_MISSING');
  END IF;

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

  IF v_treasury.branch_id = p_branch_id THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_expense_account.code, 'debit', round(p_amount, 2), 'credit', 0, 'note', COALESCE(p_description, p_category)),
      jsonb_build_object('account_code', v_source_code, 'debit', 0, 'credit', round(p_amount, 2), 'note', COALESCE(p_description, p_category))
    );

    v_entry_id := public._post_journal_entry(
      p_branch_id, 'expense', v_expense_id, btrim(p_idempotency_key),
      'Expense: ' || COALESCE(p_category, p_description, 'expense'), v_lines
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_expense_account.code, 'debit', round(p_amount, 2), 'credit', 0, 'note', COALESCE(p_description, p_category)),
      jsonb_build_object('account_key', 'treasury_clearing', 'debit', 0, 'credit', round(p_amount, 2), 'note', COALESCE(p_description, p_category))
    );

    v_entry_id := public._post_journal_entry(
      p_branch_id, 'expense', v_expense_id, btrim(p_idempotency_key),
      'Expense funded from main treasury: ' || COALESCE(p_category, p_description, 'expense'), v_lines
    );

    v_funding_lines := jsonb_build_array(
      jsonb_build_object('account_key', 'treasury_clearing', 'debit', round(p_amount, 2), 'credit', 0, 'note', COALESCE(p_description, p_category)),
      jsonb_build_object('account_code', v_source_code, 'debit', 0, 'credit', round(p_amount, 2), 'note', COALESCE(p_description, p_category))
    );

    v_funding_entry_id := public._post_journal_entry(
      v_treasury.branch_id, 'expense_funding', v_expense_id, btrim(p_idempotency_key),
      'Main treasury funding for expense: ' || COALESCE(p_category, p_description, 'expense'), v_funding_lines
    );
  END IF;

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
      'treasury_scope', v_treasury.scope,
      'treasury_branch_id', v_treasury.branch_id,
      'funding_entry_id', v_funding_entry_id,
      'expense_account_id', p_expense_account_id,
      'amount', round(p_amount, 2),
      'affects_shift_cash', v_affects_shift_cash
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'expense_id', v_expense_id,
    'journal_entry_id', v_entry_id,
    'funding_entry_id', v_funding_entry_id,
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
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_treasury public.treasury_accounts%ROWTYPE;
  v_entry_id uuid;
  v_reversal_entry_id uuid;
  v_funding_reversal_entry_id uuid;
  v_lines jsonb;
  v_funding_lines jsonb;
  v_source_code text;
  v_affects_shift_cash boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.manage') THEN RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.manage'); END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'REVERSAL_REASON_REQUIRED'); END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_expense.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_NOT_FOUND'); END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(v_expense.branch_id) THEN RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH'); END IF;

  SELECT * INTO v_treasury FROM public.treasury_accounts WHERE id = v_expense.treasury_account_id AND is_active;
  IF v_treasury.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED'); END IF;

  IF v_treasury.scope = 'organization'
     AND NOT is_pos_admin()
     AND NOT can_permission('accounting.treasury.main_cash.pay')
     AND NOT can_permission('accounting.treasury.transfer') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'MAIN_TREASURY_PAYMENT_PERMISSION_REQUIRED',
      'permission', 'accounting.treasury.main_cash.pay'
    );
  END IF;

  SELECT code INTO v_source_code
  FROM public.chart_of_accounts
  WHERE id = v_treasury.account_id AND is_active;

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

  IF v_treasury.branch_id = v_expense.branch_id THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_expense.account_id), 'debit', 0, 'credit', round(v_expense.amount, 2), 'note', p_reason),
      jsonb_build_object('account_code', v_source_code, 'debit', round(v_expense.amount, 2), 'credit', 0, 'note', p_reason)
    );

    v_reversal_entry_id := public._post_journal_entry(
      v_expense.branch_id, 'expense_reversal', p_expense_id, v_expense.idempotency_key,
      'Expense reversal: ' || p_reason, v_lines
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', (SELECT code FROM public.chart_of_accounts WHERE id = v_expense.account_id), 'debit', 0, 'credit', round(v_expense.amount, 2), 'note', p_reason),
      jsonb_build_object('account_key', 'treasury_clearing', 'debit', round(v_expense.amount, 2), 'credit', 0, 'note', p_reason)
    );

    v_reversal_entry_id := public._post_journal_entry(
      v_expense.branch_id, 'expense_reversal', p_expense_id, v_expense.idempotency_key,
      'Expense reversal: ' || p_reason, v_lines
    );

    v_funding_lines := jsonb_build_array(
      jsonb_build_object('account_key', 'treasury_clearing', 'debit', 0, 'credit', round(v_expense.amount, 2), 'note', p_reason),
      jsonb_build_object('account_code', v_source_code, 'debit', round(v_expense.amount, 2), 'credit', 0, 'note', p_reason)
    );

    v_funding_reversal_entry_id := public._post_journal_entry(
      v_treasury.branch_id, 'expense_funding_reversal', p_expense_id, v_expense.idempotency_key,
      'Main treasury expense funding reversal: ' || p_reason, v_funding_lines
    );
  END IF;

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
      'funding_reversal_entry_id', v_funding_reversal_entry_id,
      'affects_shift_cash', v_affects_shift_cash
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_reversed', false,
    'expense_id', p_expense_id,
    'journal_entry_id', v_reversal_entry_id,
    'funding_reversal_entry_id', v_funding_reversal_entry_id,
    'affects_shift_cash', v_affects_shift_cash
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_REVERSAL_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_shift_expense(text,uuid,uuid,text,text,numeric,text,uuid,uuid,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_shift_expense(text,uuid,uuid,text,text,numeric,text,uuid,uuid,date,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reverse_shift_expense(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_shift_expense(uuid,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
