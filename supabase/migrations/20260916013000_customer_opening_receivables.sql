-- Historical/opening receivables must not be represented as operational POS sales.
-- This subledger keeps the original movement date/reference while feeding the canonical AR aging and payment flows.

CREATE TABLE IF NOT EXISTS public.customer_opening_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  external_reference text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  settled_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0 AND settled_amount <= amount),
  entry_type text NOT NULL DEFAULT 'historical_charge' CHECK (entry_type IN ('opening_balance','historical_charge')),
  description text,
  source_system text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, customer_id, source_system, external_reference)
);

CREATE INDEX IF NOT EXISTS idx_customer_opening_receivables_open
  ON public.customer_opening_receivables (branch_id, customer_id, occurred_at)
  WHERE settled_amount < amount;

ALTER TABLE public.customer_opening_receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_opening_receivables_select ON public.customer_opening_receivables;
CREATE POLICY customer_opening_receivables_select
  ON public.customer_opening_receivables
  FOR SELECT
  TO authenticated
  USING (
    public.user_may_access_branch(branch_id)
    AND public.can_permission('accounts.view')
  );

REVOKE ALL ON public.customer_opening_receivables FROM anon, authenticated;
GRANT SELECT ON public.customer_opening_receivables TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ar_aging(p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
WITH open_items AS (
  SELECT
    s.customer_id,
    s.branch_id,
    s.created_at::date AS occurred_date,
    GREATEST(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0), 0)::numeric AS open_amount
  FROM public.sales s
  WHERE s.branch_id = p_branch_id
    AND s.status <> 'returned'
    AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0

  UNION ALL

  SELECT
    o.customer_id,
    o.branch_id,
    o.occurred_at::date AS occurred_date,
    GREATEST(o.amount - o.settled_amount, 0)::numeric AS open_amount
  FROM public.customer_opening_receivables o
  WHERE o.branch_id = p_branch_id
    AND (o.amount - o.settled_amount) > 0
), grouped AS (
  SELECT
    c.id AS customer_id,
    c.name,
    c.phone,
    round(sum(i.open_amount), 2) AS open_amount,
    round(sum(CASE WHEN (p_as_of - i.occurred_date) <= 30 THEN i.open_amount ELSE 0 END), 2) AS bucket_0_30,
    round(sum(CASE WHEN (p_as_of - i.occurred_date) BETWEEN 31 AND 60 THEN i.open_amount ELSE 0 END), 2) AS bucket_31_60,
    round(sum(CASE WHEN (p_as_of - i.occurred_date) BETWEEN 61 AND 90 THEN i.open_amount ELSE 0 END), 2) AS bucket_61_90,
    round(sum(CASE WHEN (p_as_of - i.occurred_date) > 90 THEN i.open_amount ELSE 0 END), 2) AS bucket_90_plus
  FROM open_items i
  JOIN public.customers c ON c.id = i.customer_id
  GROUP BY c.id, c.name, c.phone
)
SELECT COALESCE(jsonb_agg(g ORDER BY g.open_amount DESC), '[]'::jsonb)
FROM grouped g;
$function$;

CREATE OR REPLACE FUNCTION public.receive_payment(
  p_customer_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash'::text,
  p_sale_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment_id uuid;
  v_number text;
  v_user_branch uuid;
  v_remaining numeric(14,2);
  v_sale record;
  v_opening record;
  v_applied numeric(14,2);
  v_open numeric(14,2);
  v_total_open numeric(14,2);
  v_payment_account text;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
    END IF;

    IF NOT public.can_permission('sales.payment.receive') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;

    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id <> v_user_branch THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND branch_id = p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND');
    END IF;

    SELECT
      COALESCE((
        SELECT SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0))
        FROM public.sales s
        WHERE s.customer_id = p_customer_id
          AND s.branch_id = p_branch_id
          AND s.status <> 'returned'
          AND (s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)) > 0
      ), 0)
      + COALESCE((
        SELECT SUM(o.amount - o.settled_amount)
        FROM public.customer_opening_receivables o
        WHERE o.customer_id = p_customer_id
          AND o.branch_id = p_branch_id
          AND (o.amount - o.settled_amount) > 0
      ), 0)
    INTO v_total_open;

    IF p_sale_id IS NULL THEN
      IF round(p_amount, 2) > round(v_total_open, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AR',
          'open', round(v_total_open, 2), 'detail', 'The payment exceeds the customer open balance.');
      END IF;
    ELSE
      SELECT id, total, COALESCE(paid_amount, 0) AS paid_amount, COALESCE(refunded_amount, 0) AS refunded_amount
      INTO v_sale
      FROM public.sales
      WHERE id = p_sale_id
        AND customer_id = p_customer_id
        AND branch_id = p_branch_id
        AND status <> 'returned'
      FOR UPDATE;
      IF v_sale.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SALE_NOT_FOUND',
          'detail', 'No open invoice found for this customer with that id.');
      END IF;
      IF round(p_amount, 2) > round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_INVOICE',
          'open', round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2));
      END IF;
    END IF;

    v_number := (public.next_document_number('payment')->>'number')::text;

    INSERT INTO public.customer_payments
      (customer_id, branch_id, amount, payment_method, sale_id, reference_number, notes, created_by)
    VALUES
      (p_customer_id, p_branch_id, p_amount, p_payment_method, p_sale_id, v_number, p_notes, auth.uid())
    RETURNING id INTO v_payment_id;

    v_remaining := round(p_amount, 2);

    IF p_sale_id IS NOT NULL THEN
      v_open := round(v_sale.total - v_sale.paid_amount - v_sale.refunded_amount, 2);
      v_applied := LEAST(v_remaining, v_open);
      UPDATE public.sales
      SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = p_sale_id;
      v_remaining := round(v_remaining - v_applied, 2);
    ELSE
      FOR v_opening IN
        SELECT id, amount, settled_amount
        FROM public.customer_opening_receivables
        WHERE customer_id = p_customer_id
          AND branch_id = p_branch_id
          AND (amount - settled_amount) > 0
        ORDER BY occurred_at ASC, id ASC
        FOR UPDATE
      LOOP
        IF v_remaining <= 0 THEN EXIT; END IF;
        v_open := round(v_opening.amount - v_opening.settled_amount, 2);
        v_applied := LEAST(v_remaining, v_open);
        UPDATE public.customer_opening_receivables
        SET settled_amount = settled_amount + v_applied
        WHERE id = v_opening.id;
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
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          IF v_remaining <= 0 THEN EXIT; END IF;
          v_open := round(v_sale.total - COALESCE(v_sale.paid_amount, 0) - COALESCE(v_sale.refunded_amount, 0), 2);
          v_applied := LEAST(v_remaining, v_open);
          UPDATE public.sales
          SET paid_amount = COALESCE(paid_amount, 0) + v_applied
          WHERE id = v_sale.id;
          v_remaining := round(v_remaining - v_applied, 2);
        END LOOP;
      END IF;
    END IF;

    v_payment_account := CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END;
    v_lines := v_lines || jsonb_build_object('account_key', v_payment_account,
      'debit', round(p_amount, 2), 'credit', 0, 'note', v_number);
    v_lines := v_lines || jsonb_build_object('account_key', 'ar',
      'debit', 0, 'credit', round(p_amount, 2), 'customer_id', p_customer_id, 'note', v_number);

    PERFORM public._post_journal_entry(p_branch_id, 'payment', v_payment_id, v_number,
      'سند قبض ' || v_number, v_lines);

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'reference_number', v_number,
      'unapplied', v_remaining);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

COMMENT ON TABLE public.customer_opening_receivables IS
  'Historical/opening customer AR movements kept outside operational sales and inventory flows.';
