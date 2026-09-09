-- Final handover: make offline sale replay idempotent and reconcilable.
--
-- A client can lose the HTTP response after process_sale has COMMITed. Without a
-- uniqueness boundary, replaying the same durable outbox item can create a second
-- financial sale. The branch/invoice pair is the stable financial identity and is
-- now enforced at the database boundary.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sales
    WHERE branch_id IS NOT NULL
    GROUP BY branch_id, invoice_number
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot install offline reconciliation guard: duplicate branch/invoice sales already exist';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sales_branch_invoice_unique
  ON public.sales (branch_id, invoice_number)
  WHERE branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_offline_sale(
  p_invoice_number text,
  p_branch_id uuid,
  p_paid_amount numeric,
  p_payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERMISSION_DENIED',
      'permission', 'pos.payment.take'
    );
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Reconciliation is deliberately unavailable to ordinary online document
  -- numbers. Only the durable offline namespace may use this recovery path.
  IF p_invoice_number IS NULL OR p_invoice_number NOT LIKE 'INV-OFF-%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_OFFLINE_INVOICE');
  END IF;

  SELECT s.*
  INTO v_sale
  FROM public.sales s
  WHERE s.branch_id = p_branch_id
    AND s.invoice_number = p_invoice_number
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'OFFLINE_SALE_NOT_FOUND');
  END IF;

  -- A matching key is considered the same queued financial action only when
  -- settlement identity also matches. This rejects a tampered/colliding outbox
  -- row rather than falsely acknowledging another sale.
  IF abs(COALESCE(v_sale.paid_amount, 0) - GREATEST(COALESCE(p_paid_amount, 0), 0)) > 0.01
     OR COALESCE(v_sale.payment_method, '') <> COALESCE(p_payment_method, '') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'OFFLINE_RECONCILIATION_CONFLICT',
      'invoice_number', p_invoice_number
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reconciled', true,
    'sale_id', v_sale.id,
    'invoice_number', v_sale.invoice_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text)
IS 'Confirms a previously committed offline sale after an ambiguous client response; permission-first and branch scoped.';
