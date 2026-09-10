-- Safe supplier statements and employee credit account mapping.
-- No destructive changes. Existing AR/AP, POS, shift and payment flows remain authoritative.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS employee_user_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_employee_user_id_fkey'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_employee_user_id_fkey
      FOREIGN KEY (employee_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_branch_employee_credit_uidx
  ON public.customers(branch_id, employee_user_id)
  WHERE employee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_employee_credit_lookup_idx
  ON public.customers(employee_user_id, branch_id)
  WHERE employee_user_id IS NOT NULL;

-- Supplier statement uses purchases.paid_amount as the authoritative cumulative paid
-- value because pay_supplier increments it. supplier_payments is used only for the
-- detailed payment-method history, never added again to the balance.
CREATE OR REPLACE FUNCTION public.get_supplier_statement(
  p_supplier_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_summary jsonb;
  v_entries jsonb;
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
    WHERE s.id = p_supplier_id AND s.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_FOUND');
  END IF;

  SELECT jsonb_build_object(
    'supplier_id', s.id,
    'supplier_name', s.name,
    'total_purchases', COALESCE(x.total_purchases, 0),
    'total_returns', COALESCE(x.total_returns, 0),
    'total_paid', COALESCE(x.total_paid, 0),
    'open_balance', COALESCE(x.open_balance, 0),
    'recorded_cash_payments', COALESCE(y.cash_paid, 0),
    'recorded_card_payments', COALESCE(y.card_paid, 0),
    'recorded_transfer_payments', COALESCE(y.transfer_paid, 0),
    'recorded_other_payments', COALESCE(y.other_paid, 0),
    'recorded_payments_total', COALESCE(y.recorded_total, 0),
    'invoice_time_paid', GREATEST(COALESCE(x.total_paid, 0) - COALESCE(y.recorded_total, 0), 0)
  )
  INTO v_summary
  FROM public.suppliers s
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(p.total), 0) AS total_purchases,
      COALESCE(sum(p.returned_amount), 0) AS total_returns,
      COALESCE(sum(p.paid_amount), 0) AS total_paid,
      COALESCE(sum(GREATEST(
        COALESCE(p.total, 0) - COALESCE(p.returned_amount, 0) - COALESCE(p.paid_amount, 0),
        0
      )), 0) AS open_balance
    FROM public.purchases p
    WHERE p.supplier_id = s.id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(sp.amount), 0) AS recorded_total,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method = 'cash'), 0) AS cash_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method = 'card'), 0) AS card_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method IN ('transfer','bank_transfer')), 0) AS transfer_paid,
      COALESCE(sum(sp.amount) FILTER (WHERE sp.payment_method NOT IN ('cash','card','transfer','bank_transfer')), 0) AS other_paid
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = s.id
      AND sp.branch_id = p_branch_id
  ) y ON true
  WHERE s.id = p_supplier_id AND s.branch_id = p_branch_id;

  WITH events AS (
    SELECT
      p.created_at AS event_at,
      'purchase'::text AS entry_type,
      p.id AS source_id,
      p.invoice_number AS reference_number,
      GREATEST(COALESCE(p.total, 0) - COALESCE(p.returned_amount, 0), 0)::numeric AS debit,
      0::numeric AS credit,
      p.payment_method::text AS payment_method,
      CASE WHEN COALESCE(p.returned_amount, 0) > 0
        THEN 'Net purchase after returns'
        ELSE 'Purchase invoice'
      END::text AS description
    FROM public.purchases p
    WHERE p.supplier_id = p_supplier_id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'

    UNION ALL

    SELECT
      sp.created_at,
      'payment'::text,
      sp.id,
      sp.reference_number,
      0::numeric,
      COALESCE(sp.amount, 0)::numeric,
      sp.payment_method::text,
      COALESCE(NULLIF(sp.notes, ''), 'Supplier payment')::text
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = p_supplier_id
      AND sp.branch_id = p_branch_id
  ), running AS (
    SELECT
      e.*,
      sum(e.debit - e.credit) OVER (
        ORDER BY e.event_at, e.entry_type, e.source_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM events e
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'event_at', r.event_at,
    'entry_type', r.entry_type,
    'source_id', r.source_id,
    'reference_number', r.reference_number,
    'debit', round(r.debit, 2),
    'credit', round(r.credit, 2),
    'payment_method', r.payment_method,
    'description', r.description,
    'running_balance', round(r.running_balance, 2)
  ) ORDER BY r.event_at DESC, r.entry_type DESC, r.source_id DESC), '[]'::jsonb)
  INTO v_entries
  FROM running r;

  RETURN jsonb_build_object('success', true, 'summary', v_summary, 'entries', v_entries);
END;
$$;

-- Link an existing branch customer account to one employee. POS continues to use
-- the proven generic customer-credit path; this link only classifies the AR account.
CREATE OR REPLACE FUNCTION public.link_employee_credit_account(
  p_customer_id uuid,
  p_employee_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('customers.manage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'customers.manage');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = p_customer_id AND c.branch_id = p_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_employee_id
      AND u.is_active = true
      AND (u.branch_id = p_branch_id OR u.branch_id IS NULL)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_FOUND_IN_BRANCH');
  END IF;

  UPDATE public.customers
  SET employee_user_id = p_employee_id
  WHERE id = p_customer_id AND branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'employee_id', p_employee_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_ALREADY_LINKED');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employee_credit_balances(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF NOT public.can_permission('accounts.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'accounts.view');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', q.employee_id,
    'customer_id', q.customer_id,
    'employee_name', q.employee_name,
    'phone', q.phone,
    'open_amount', round(q.open_amount, 2),
    'bucket_0_30', round(q.bucket_0_30, 2),
    'bucket_31_60', round(q.bucket_31_60, 2),
    'bucket_61_90', round(q.bucket_61_90, 2),
    'bucket_90_plus', round(q.bucket_90_plus, 2)
  ) ORDER BY q.open_amount DESC, q.employee_name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      u.id AS employee_id,
      c.id AS customer_id,
      COALESCE(NULLIF(u.full_name, ''), u.email, c.name) AS employee_name,
      u.phone,
      COALESCE(sum(GREATEST(
        COALESCE(s.total, 0) - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0),
        0
      )), 0) AS open_amount,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) <= 30
        THEN GREATEST(COALESCE(s.total, 0) - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 0)
        ELSE 0 END), 0) AS bucket_0_30,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) BETWEEN 31 AND 60
        THEN GREATEST(COALESCE(s.total, 0) - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 0)
        ELSE 0 END), 0) AS bucket_31_60,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) BETWEEN 61 AND 90
        THEN GREATEST(COALESCE(s.total, 0) - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 0)
        ELSE 0 END), 0) AS bucket_61_90,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) > 90
        THEN GREATEST(COALESCE(s.total, 0) - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 0)
        ELSE 0 END), 0) AS bucket_90_plus
    FROM public.customers c
    JOIN public.users u ON u.id = c.employee_user_id
    LEFT JOIN public.sales s
      ON s.customer_id = c.id
      AND s.branch_id = p_branch_id
      AND s.status <> 'returned'
    WHERE c.branch_id = p_branch_id
      AND c.employee_user_id IS NOT NULL
    GROUP BY u.id, c.id, u.full_name, u.email, u.phone, c.name
  ) q
  WHERE q.open_amount > 0;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

-- Employee settlement reuses receive_payment, so the existing AR validation,
-- journal posting and overpayment protection remain the only write path.
CREATE OR REPLACE FUNCTION public.receive_employee_credit_payment(
  p_employee_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash',
  p_sale_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_customer_id uuid;
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

  SELECT c.id
  INTO v_customer_id
  FROM public.customers c
  WHERE c.branch_id = p_branch_id
    AND c.employee_user_id = p_employee_id;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_CREDIT_ACCOUNT_NOT_FOUND');
  END IF;

  RETURN public.receive_payment(
    v_customer_id,
    p_branch_id,
    p_amount,
    p_payment_method,
    p_sale_id,
    p_notes
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_supplier_statement(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.link_employee_credit_account(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_employee_credit_balances(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receive_employee_credit_payment(uuid, uuid, numeric, text, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_employee_credit_account(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_credit_balances(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_employee_credit_payment(uuid, uuid, numeric, text, uuid, text) TO authenticated;
