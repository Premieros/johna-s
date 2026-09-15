-- Historical/opening employee receivables must not be represented as POS sales.
-- They remain customer receivables, are branch scoped, and can be settled alongside future credit sales.

CREATE TABLE IF NOT EXISTS public.employee_receivable_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  reference_number text,
  entry_type text NOT NULL DEFAULT 'historical_charge',
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  settled_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0 AND settled_amount <= amount),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_receivable_entries_type_check CHECK (entry_type IN ('opening_balance','historical_charge')),
  CONSTRAINT employee_receivable_entries_branch_customer_ref_unique UNIQUE (branch_id, customer_id, entry_type, reference_number)
);

CREATE INDEX IF NOT EXISTS idx_employee_receivable_entries_branch_customer_date
  ON public.employee_receivable_entries(branch_id, customer_id, occurred_at, id);

ALTER TABLE public.employee_receivable_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_receivable_entries_select ON public.employee_receivable_entries;
CREATE POLICY employee_receivable_entries_select
ON public.employee_receivable_entries
FOR SELECT
TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND public.can_permission('accounts.view')
);

REVOKE ALL ON TABLE public.employee_receivable_entries FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.employee_receivable_entries FROM authenticated;
GRANT SELECT ON TABLE public.employee_receivable_entries TO authenticated;

CREATE OR REPLACE FUNCTION public.get_employee_receivable_balances(
  p_branch_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT public.can_permission('accounts.view') THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH source_rows AS (
    SELECT
      s.customer_id,
      (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0))::numeric(14,2) AS open_amount,
      s.created_at::date AS source_date
    FROM public.sales s
    JOIN public.customers c ON c.id = s.customer_id
    WHERE s.branch_id = p_branch_id
      AND c.customer_type = 'employee'
      AND s.status <> 'returned'
      AND s.created_at::date <= p_as_of
      AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0

    UNION ALL

    SELECT
      e.customer_id,
      (e.amount - e.settled_amount)::numeric(14,2) AS open_amount,
      e.occurred_at::date AS source_date
    FROM public.employee_receivable_entries e
    JOIN public.customers c ON c.id = e.customer_id
    WHERE e.branch_id = p_branch_id
      AND c.customer_type = 'employee'
      AND e.occurred_at::date <= p_as_of
      AND (e.amount - e.settled_amount) > 0
  ), aggregated AS (
    SELECT
      c.id AS customer_id,
      c.name,
      c.phone,
      COALESCE(SUM(sr.open_amount), 0)::numeric(14,2) AS open_amount,
      COALESCE(SUM(CASE WHEN (p_as_of - sr.source_date) <= 30 THEN sr.open_amount ELSE 0 END), 0)::numeric(14,2) AS bucket_0_30,
      COALESCE(SUM(CASE WHEN (p_as_of - sr.source_date) BETWEEN 31 AND 60 THEN sr.open_amount ELSE 0 END), 0)::numeric(14,2) AS bucket_31_60,
      COALESCE(SUM(CASE WHEN (p_as_of - sr.source_date) BETWEEN 61 AND 90 THEN sr.open_amount ELSE 0 END), 0)::numeric(14,2) AS bucket_61_90,
      COALESCE(SUM(CASE WHEN (p_as_of - sr.source_date) > 90 THEN sr.open_amount ELSE 0 END), 0)::numeric(14,2) AS bucket_90_plus
    FROM public.customers c
    LEFT JOIN source_rows sr ON sr.customer_id = c.id
    WHERE c.branch_id = p_branch_id
      AND c.customer_type = 'employee'
    GROUP BY c.id, c.name, c.phone
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.open_amount DESC, a.name), '[]'::jsonb)
  INTO v_rows
  FROM aggregated a;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_employee_receivable_payment(
  p_customer_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total_open numeric(14,2);
  v_remaining numeric(14,2);
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_hist record;
  v_sale record;
  v_payment_id uuid;
  v_number text;
  v_payment_account text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('sales.payment.receive') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'sales.payment.receive');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.branch_id = p_branch_id
      AND c.customer_type = 'employee'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_CUSTOMER_NOT_FOUND');
  END IF;

  SELECT round(
    COALESCE((SELECT SUM(e.amount - e.settled_amount)
              FROM public.employee_receivable_entries e
              WHERE e.customer_id = p_customer_id
                AND e.branch_id = p_branch_id
                AND (e.amount - e.settled_amount) > 0), 0)
    +
    COALESCE((SELECT SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0))
              FROM public.sales s
              WHERE s.customer_id = p_customer_id
                AND s.branch_id = p_branch_id
                AND s.status <> 'returned'
                AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0), 0)
  , 2) INTO v_total_open;

  IF round(p_amount, 2) > round(v_total_open, 2) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AR', 'open', v_total_open);
  END IF;

  v_number := (public.next_document_number('payment')->>'number')::text;

  INSERT INTO public.customer_payments
    (customer_id, branch_id, amount, payment_method, sale_id, reference_number, notes, created_by)
  VALUES
    (p_customer_id, p_branch_id, round(p_amount, 2), COALESCE(p_payment_method, 'cash'), NULL, v_number, p_notes, auth.uid())
  RETURNING id INTO v_payment_id;

  v_remaining := round(p_amount, 2);

  FOR v_hist IN
    SELECT id, amount, settled_amount
    FROM public.employee_receivable_entries
    WHERE customer_id = p_customer_id
      AND branch_id = p_branch_id
      AND (amount - settled_amount) > 0
    ORDER BY occurred_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_open := round(v_hist.amount - v_hist.settled_amount, 2);
    v_applied := LEAST(v_remaining, v_open);
    UPDATE public.employee_receivable_entries
    SET settled_amount = settled_amount + v_applied
    WHERE id = v_hist.id;
    v_remaining := round(v_remaining - v_applied, 2);
  END LOOP;

  IF v_remaining > 0 THEN
    FOR v_sale IN
      SELECT id, total, paid_amount, refunded_amount
      FROM public.sales
      WHERE customer_id = p_customer_id
        AND branch_id = p_branch_id
        AND status <> 'returned'
        AND (total - COALESCE(paid_amount, 0) - COALESCE(refunded_amount, 0)) > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_open := round(v_sale.total - COALESCE(v_sale.paid_amount, 0) - COALESCE(v_sale.refunded_amount, 0), 2);
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.sales
      SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = v_sale.id;
      v_remaining := round(v_remaining - v_applied, 2);
    END LOOP;
  END IF;

  v_payment_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
  v_lines := v_lines || jsonb_build_object('account_key', v_payment_account,
    'debit', round(p_amount, 2), 'credit', 0, 'note', v_number);
  v_lines := v_lines || jsonb_build_object('account_key', 'ar',
    'debit', 0, 'credit', round(p_amount, 2), 'customer_id', p_customer_id, 'note', v_number);

  PERFORM public._post_journal_entry(
    p_branch_id,
    'employee_receivable_payment',
    v_payment_id,
    v_number,
    'سداد ذمة موظف ' || v_number,
    v_lines
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'reference_number', v_number,
    'unapplied', v_remaining,
    'open_before', v_total_open,
    'open_after', round(v_total_open - p_amount, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_receivable_balances(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_receivable_balances(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_employee_receivable_payment(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_employee_receivable_payment(uuid, uuid, numeric, text, text) TO authenticated;
