-- Final handover: preserve operator identity across offline replay/reconciliation.
--
-- process_sale records sales.cashier_id from auth.uid(). A durable offline queue
-- created by one cashier must therefore never be replayed or reconciled by a
-- different user who later signs in on the same shared terminal.

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

  -- Never let a later login on the same device acknowledge another cashier's
  -- committed offline sale. This also prevents a caller with branch/payment
  -- permission from using a known offline invoice to clear someone else's outbox.
  IF v_sale.cashier_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'OFFLINE_SALE_OWNER_MISMATCH',
      'invoice_number', p_invoice_number
    );
  END IF;

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

ALTER FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.reconcile_offline_sale(text, uuid, numeric, text)
IS 'Confirms only the originating cashier''s previously committed offline sale; permission-first, branch-scoped, settlement-matched, and operator-attribution safe.';

NOTIFY pgrst, 'reload schema';
