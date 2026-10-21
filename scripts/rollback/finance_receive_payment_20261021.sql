SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $rollback$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.receive_payment(uuid,uuid,numeric,text,uuid,text)'::regprocedure)) <> 'a2202027bd61275c6fa3f896ec099d53' THEN RAISE EXCEPTION 'FINANCE_ROLLBACK_BASELINE_CHANGED'; END IF;
 EXECUTE $restore$CREATE OR REPLACE FUNCTION public.receive_payment(p_customer_id uuid, p_branch_id uuid, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_sale_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
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

    IF p_sale_id IS NULL AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = p_customer_id
        AND c.branch_id = p_branch_id
        AND c.customer_type = 'employee'
    ) THEN
      RETURN public.receive_employee_receivable_payment(
        p_customer_id,
        p_branch_id,
        p_amount,
        p_payment_method,
        p_notes
      );
    END IF;

    SELECT COALESCE(SUM(s.total - COALESCE(s.paid_amount, 0) - COALESCE(s.refunded_amount, 0)), 0)
    INTO v_total_open
    FROM public.sales s
    WHERE s.customer_id = p_customer_id
      AND s.branch_id = p_branch_id
      AND s.status <> 'returned';

    IF p_sale_id IS NULL THEN
      IF round(p_amount, 2) > round(v_total_open, 2) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_EXCEEDS_AR',
          'open', round(v_total_open, 2), 'detail', 'The payment exceeds the customer open balance.');
      END IF;
    ELSE
      SELECT total, COALESCE(paid_amount, 0), COALESCE(refunded_amount, 0) INTO v_sale
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
      UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
      WHERE id = p_sale_id;
      v_remaining := round(v_remaining - v_applied, 2);
    ELSIF v_remaining > 0 THEN
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
        UPDATE public.sales SET paid_amount = COALESCE(paid_amount, 0) + v_applied
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
      'payment',
      v_payment_id,
      v_number,
      'سند قبض ' || v_number,
      v_lines
    );

    RETURN jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'reference_number', v_number,
      'unapplied', v_remaining
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
$restore$;
END $rollback$;
