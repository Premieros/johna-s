-- Safe account balances, supplier statements and employee credit.
-- No destructive changes. Existing AR/AP, shift, inventory and payment flows remain authoritative.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS employee_user_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
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
    'total_paid', COALESCE(y.total_paid, 0),
    'cash_paid', COALESCE(y.cash_paid, 0),
    'card_paid', COALESCE(y.card_paid, 0),
    'transfer_paid', COALESCE(y.transfer_paid, 0),
    'other_paid', COALESCE(y.other_paid, 0),
    'open_balance', GREATEST(COALESCE(x.total_purchases, 0) - COALESCE(x.total_returns, 0) - COALESCE(y.total_paid, 0), 0)
  )
  INTO v_summary
  FROM public.suppliers s
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(p.total), 0) AS total_purchases,
      COALESCE(sum(p.returned_amount), 0) AS total_returns
    FROM public.purchases p
    WHERE p.supplier_id = s.id
      AND p.branch_id = p_branch_id
      AND p.status = 'completed'
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(sp.amount), 0) AS total_paid,
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
      GREATEST(COALESCE(p.total,0) - COALESCE(p.returned_amount,0), 0)::numeric AS debit,
      0::numeric AS credit,
      p.payment_method::text AS payment_method,
      CASE WHEN COALESCE(p.returned_amount,0) > 0
           THEN 'Net purchase after returns'
           ELSE 'Purchase invoice' END::text AS description
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
      COALESCE(sp.amount,0)::numeric,
      sp.payment_method::text,
      COALESCE(NULLIF(sp.notes,''), 'Supplier payment')::text
    FROM public.supplier_payments sp
    WHERE sp.supplier_id = p_supplier_id
      AND sp.branch_id = p_branch_id
  ), running AS (
    SELECT e.*,
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
    'debit', round(r.debit,2),
    'credit', round(r.credit,2),
    'payment_method', r.payment_method,
    'description', r.description,
    'running_balance', round(r.running_balance,2)
  ) ORDER BY r.event_at DESC, r.entry_type DESC), '[]'::jsonb)
  INTO v_entries
  FROM running r;

  RETURN jsonb_build_object('success', true, 'summary', v_summary, 'entries', v_entries);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_employee_credit_sale(
  p_invoice_number text,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_employee_id uuid,
  p_salesperson_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_type text,
  p_tax_amount numeric,
  p_bonus_amount numeric,
  p_total numeric,
  p_status text,
  p_items jsonb,
  p_shift_id uuid DEFAULT NULL,
  p_order_type text DEFAULT 'takeaway',
  p_table_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_guest_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_employee record;
  v_customer_id uuid;
  v_core jsonb;
  v_sale_id uuid;
  v_sale_total numeric(14,2);
  v_entry_id uuid;
  v_cash_account uuid;
  v_ar_account uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.payment.take');
  END IF;
  IF NOT public.can_permission('employees.credit.create') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'employees.credit.create');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT u.id, u.full_name, u.email, u.phone, u.branch_id, u.is_active
  INTO v_employee
  FROM public.users u
  WHERE u.id = p_employee_id
    AND u.is_active = true
    AND (u.branch_id = p_branch_id OR u.branch_id IS NULL);

  IF v_employee.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_NOT_FOUND_IN_BRANCH');
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.branch_id = p_branch_id
    AND c.employee_user_id = p_employee_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers(name, name_en, phone, email, balance, notes, branch_id, employee_user_id)
    VALUES (
      COALESCE(NULLIF(v_employee.full_name,''), v_employee.email, 'Employee'),
      COALESCE(NULLIF(v_employee.full_name,''), v_employee.email, 'Employee'),
      v_employee.phone,
      v_employee.email,
      0,
      'SYSTEM_EMPLOYEE_CREDIT_ACCOUNT',
      p_branch_id,
      p_employee_id
    )
    RETURNING id INTO v_customer_id;
  END IF;

  -- Reuse the canonical sale transaction for totals, stock, approvals and order settlement.
  -- The temporary collection is atomically reclassified to AR before this function returns.
  v_core := public.process_sale(
    p_invoice_number,
    p_branch_id,
    p_warehouse_id,
    v_customer_id,
    p_salesperson_id,
    p_subtotal,
    p_discount_amount,
    p_discount_type,
    p_tax_amount,
    p_bonus_amount,
    p_total,
    p_total,
    'cash',
    p_status,
    p_items,
    p_shift_id,
    p_order_type,
    p_table_id,
    p_order_id,
    p_guest_count
  );

  IF COALESCE((v_core->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_core;
  END IF;

  v_sale_id := NULLIF(v_core->>'sale_id','')::uuid;
  SELECT s.total INTO v_sale_total
  FROM public.sales s
  WHERE s.id = v_sale_id AND s.branch_id = p_branch_id
  FOR UPDATE;

  IF v_sale_id IS NULL OR v_sale_total IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_CREDIT_SALE_NOT_FOUND_AFTER_CORE';
  END IF;

  UPDATE public.sales
  SET customer_id = v_customer_id,
      paid_amount = 0,
      payment_method = 'employee_credit'
  WHERE id = v_sale_id AND branch_id = p_branch_id;

  -- Preserve shift attribution with a zero-value receivable marker. close_shift only
  -- counts cash movements, so employee credit can never inflate expected drawer cash.
  DELETE FROM public.shift_operations
  WHERE reference_type = 'sale'
    AND reference_id = v_sale_id
    AND operation_type = 'sale';

  IF p_shift_id IS NOT NULL THEN
    INSERT INTO public.shift_operations(
      shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by
    )
    VALUES (
      p_shift_id, 'sale', 0, 'employee_credit', 'sale', v_sale_id, auth.uid()
    );
  END IF;

  SELECT je.id INTO v_entry_id
  FROM public.journal_entries je
  WHERE je.branch_id = p_branch_id
    AND je.reference_type = 'sale'
    AND je.reference_id = v_sale_id
  ORDER BY je.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_CREDIT_JOURNAL_NOT_FOUND';
  END IF;

  v_cash_account := public.resolve_account_key(p_branch_id, 'cash');
  v_ar_account := public.resolve_account_key(p_branch_id, 'ar');

  DELETE FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_entry_id
    AND jel.account_id = v_cash_account
    AND jel.debit > 0;

  INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, customer_id, note)
  VALUES (v_entry_id, v_ar_account, round(v_sale_total,2), 0, v_customer_id, p_invoice_number || ' · employee_credit');

  IF p_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET payment_status = 'unpaid', payment_at = NULL, updated_at = now()
    WHERE id = p_order_id AND branch_id = p_branch_id;
  END IF;

  RETURN v_core || jsonb_build_object(
    'employee_credit', true,
    'employee_id', p_employee_id,
    'employee_customer_id', v_customer_id,
    'paid_amount', 0,
    'credit_amount', round(v_sale_total,2)
  );
EXCEPTION WHEN OTHERS THEN
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
  IF NOT public.can_permission('employees.credit.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'employees.credit.view');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', q.employee_id,
    'customer_id', q.customer_id,
    'employee_name', q.employee_name,
    'phone', q.phone,
    'open_amount', round(q.open_amount,2),
    'bucket_0_30', round(q.bucket_0_30,2),
    'bucket_31_60', round(q.bucket_31_60,2),
    'bucket_61_90', round(q.bucket_61_90,2),
    'bucket_90_plus', round(q.bucket_90_plus,2)
  ) ORDER BY q.open_amount DESC, q.employee_name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      u.id AS employee_id,
      c.id AS customer_id,
      COALESCE(NULLIF(u.full_name,''), u.email, c.name) AS employee_name,
      u.phone,
      COALESCE(sum(GREATEST(s.total - COALESCE(s.paid_amount,0) - COALESCE(s.refunded_amount,0),0)),0) AS open_amount,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) <= 30 THEN GREATEST(s.total - COALESCE(s.paid_amount,0) - COALESCE(s.refunded_amount,0),0) ELSE 0 END),0) AS bucket_0_30,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) BETWEEN 31 AND 60 THEN GREATEST(s.total - COALESCE(s.paid_amount,0) - COALESCE(s.refunded_amount,0),0) ELSE 0 END),0) AS bucket_31_60,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) BETWEEN 61 AND 90 THEN GREATEST(s.total - COALESCE(s.paid_amount,0) - COALESCE(s.refunded_amount,0),0) ELSE 0 END),0) AS bucket_61_90,
      COALESCE(sum(CASE WHEN (CURRENT_DATE - s.created_at::date) > 90 THEN GREATEST(s.total - COALESCE(s.paid_amount,0) - COALESCE(s.refunded_amount,0),0) ELSE 0 END),0) AS bucket_90_plus
    FROM public.customers c
    JOIN public.users u ON u.id = c.employee_user_id
    LEFT JOIN public.sales s ON s.customer_id = c.id
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
  IF NOT public.can_permission('employees.credit.settle') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'employees.credit.settle');
  END IF;
  IF NOT public.can_permission('sales.payment.receive') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'sales.payment.receive');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.branch_id = p_branch_id
    AND c.employee_user_id = p_employee_id;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPLOYEE_CREDIT_ACCOUNT_NOT_FOUND');
  END IF;

  RETURN public.receive_payment(v_customer_id, p_branch_id, p_amount, p_payment_method, p_sale_id, p_notes);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_supplier_statement(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_employee_credit_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,text,jsonb,uuid,text,uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_employee_credit_balances(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receive_employee_credit_payment(uuid,uuid,numeric,text,uuid,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_supplier_statement(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_employee_credit_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,text,jsonb,uuid,text,uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_credit_balances(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_employee_credit_payment(uuid,uuid,numeric,text,uuid,text) TO authenticated;
