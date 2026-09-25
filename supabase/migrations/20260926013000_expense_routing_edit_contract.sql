-- Expense routing + safe edit contract
-- No historical data is rewritten by this migration.

CREATE TABLE IF NOT EXISTS public.expense_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  category text NOT NULL,
  expense_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  treasury_account_id uuid NOT NULL REFERENCES public.treasury_accounts(id),
  payment_method text NOT NULL DEFAULT 'cash',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES public.users(id),
  CONSTRAINT expense_routing_rules_category_nonempty CHECK (btrim(category) <> ''),
  CONSTRAINT expense_routing_rules_payment_method_check CHECK (payment_method IN ('cash','card','transfer'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_routing_rules_branch_category
  ON public.expense_routing_rules(branch_id, lower(btrim(category)));

CREATE INDEX IF NOT EXISTS idx_expense_routing_rules_branch_active
  ON public.expense_routing_rules(branch_id, is_active, category);

ALTER TABLE public.expense_routing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_routing_rules_select ON public.expense_routing_rules;
CREATE POLICY expense_routing_rules_select
  ON public.expense_routing_rules
  FOR SELECT TO authenticated
  USING (
    is_pos_admin()
    OR (
      user_may_access_branch(branch_id)
      AND (can_permission('expenses.manage') OR can_permission('expenses.routing.manage'))
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.expense_routing_rules FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_expense_routing_rules(p_branch_id uuid)
RETURNS TABLE (
  id uuid,
  category text,
  expense_account_id uuid,
  expense_account_code text,
  expense_account_name text,
  treasury_account_id uuid,
  treasury_account_name text,
  treasury_account_type text,
  payment_method text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;
  IF NOT is_pos_admin()
     AND NOT can_permission('expenses.manage')
     AND NOT can_permission('expenses.routing.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.category,
    r.expense_account_id,
    a.code,
    COALESCE(a.name, a.name_en, a.code),
    r.treasury_account_id,
    t.account_name,
    t.account_type,
    r.payment_method,
    r.is_active
  FROM public.expense_routing_rules r
  JOIN public.chart_of_accounts a ON a.id = r.expense_account_id
  JOIN public.treasury_accounts t ON t.id = r.treasury_account_id
  WHERE r.branch_id = p_branch_id
  ORDER BY lower(r.category);
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_expense_routing_rule(
  p_branch_id uuid,
  p_category text,
  p_expense_account_id uuid,
  p_treasury_account_id uuid,
  p_payment_method text DEFAULT 'cash',
  p_is_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT is_pos_admin() AND NOT can_permission('expenses.routing.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.routing.manage');
  END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF p_category IS NULL OR btrim(p_category) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CATEGORY_REQUIRED');
  END IF;
  IF COALESCE(p_payment_method, '') NOT IN ('cash','card','transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PAYMENT_METHOD');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.chart_of_accounts a
    WHERE a.id = p_expense_account_id
      AND a.branch_id = p_branch_id
      AND a.account_type = 'expense'
      AND a.is_active
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_EXPENSE_ACCOUNT');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.treasury_accounts t
    WHERE t.id = p_treasury_account_id
      AND t.branch_id = p_branch_id
      AND t.is_active
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TREASURY_ACCOUNT');
  END IF;

  INSERT INTO public.expense_routing_rules(
    branch_id, category, expense_account_id, treasury_account_id,
    payment_method, is_active, created_by, updated_by
  ) VALUES (
    p_branch_id, lower(btrim(p_category)), p_expense_account_id, p_treasury_account_id,
    p_payment_method, COALESCE(p_is_active, true), v_uid, v_uid
  )
  ON CONFLICT (branch_id, lower(btrim(category)))
  DO UPDATE SET
    expense_account_id = EXCLUDED.expense_account_id,
    treasury_account_id = EXCLUDED.treasury_account_id,
    payment_method = EXCLUDED.payment_method,
    is_active = EXCLUDED.is_active,
    updated_at = now(),
    updated_by = v_uid
  RETURNING id INTO v_id;

  PERFORM public.log_audit_action(
    p_branch_id,
    'expense_routing_updated',
    'expense_routing_rule',
    v_id,
    jsonb_build_object(
      'category', lower(btrim(p_category)),
      'expense_account_id', p_expense_account_id,
      'treasury_account_id', p_treasury_account_id,
      'payment_method', p_payment_method,
      'is_active', COALESCE(p_is_active, true)
    )
  );

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_ROUTING_UPDATE_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_shift_expense(
  p_expense_id uuid,
  p_idempotency_key text,
  p_category text,
  p_description text,
  p_amount numeric,
  p_payment_method text,
  p_expense_account_id uuid,
  p_treasury_account_id uuid,
  p_expense_date date,
  p_notes text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.expenses%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_reverse jsonb;
  v_post jsonb;
  v_new_expense_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT is_pos_admin()
     AND (NOT can_permission('expenses.edit') OR NOT can_permission('expenses.manage')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'expenses.edit');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EDIT_REASON_REQUIRED');
  END IF;

  SELECT * INTO v_old
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF v_old.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_NOT_FOUND');
  END IF;
  IF v_old.status <> 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_NOT_POSTED');
  END IF;
  IF NOT is_pos_admin() AND NOT user_may_access_branch(v_old.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = v_old.shift_id AND branch_id = v_old.branch_id
  FOR UPDATE;

  IF v_shift.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SHIFT_NOT_FOUND');
  END IF;
  IF v_shift.status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'CLOSED_SHIFT_EXPENSE_EDIT_BLOCKED');
  END IF;

  v_reverse := public.reverse_shift_expense(
    p_expense_id,
    'EDIT: ' || btrim(p_reason)
  );

  IF COALESCE((v_reverse->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'EXPENSE_EDIT_REVERSE_FAILED: %', COALESCE(v_reverse->>'detail', v_reverse->>'error', 'unknown');
  END IF;

  v_post := public.post_shift_expense(
    p_idempotency_key,
    v_old.branch_id,
    v_old.shift_id,
    p_category,
    p_description,
    p_amount,
    p_payment_method,
    p_expense_account_id,
    p_treasury_account_id,
    p_expense_date,
    p_notes
  );

  IF COALESCE((v_post->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'EXPENSE_EDIT_REPOST_FAILED: %', COALESCE(v_post->>'detail', v_post->>'error', 'unknown');
  END IF;

  v_new_expense_id := NULLIF(v_post->>'expense_id', '')::uuid;

  PERFORM public.log_audit_action(
    v_old.branch_id,
    'expense_edited',
    'expense',
    p_expense_id,
    jsonb_build_object(
      'replacement_expense_id', v_new_expense_id,
      'reason', btrim(p_reason),
      'old', jsonb_build_object(
        'category', v_old.category,
        'description', v_old.description,
        'amount', v_old.amount,
        'payment_method', v_old.payment_method,
        'expense_account_id', v_old.account_id,
        'treasury_account_id', v_old.treasury_account_id,
        'expense_date', v_old.expense_date
      ),
      'new', jsonb_build_object(
        'category', p_category,
        'description', p_description,
        'amount', round(p_amount, 2),
        'payment_method', p_payment_method,
        'expense_account_id', p_expense_account_id,
        'treasury_account_id', p_treasury_account_id,
        'expense_date', p_expense_date
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'old_expense_id', p_expense_id,
    'replacement_expense_id', v_new_expense_id,
    'journal_entry_id', v_post->>'journal_entry_id'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'EXPENSE_EDIT_FAILED', 'detail', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_expense_routing_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expense_routing_rules(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_expense_routing_rule(uuid,text,uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_expense_routing_rule(uuid,text,uuid,uuid,text,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.edit_shift_expense(uuid,text,text,text,numeric,text,uuid,uuid,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_shift_expense(uuid,text,text,text,numeric,text,uuid,uuid,date,text,text) TO authenticated;
