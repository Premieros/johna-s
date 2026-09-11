-- Transactional correction for completed purchase invoices.
-- The existing purchase-return and purchase-create contracts remain the only
-- writers of inventory/accounting effects. We never mutate stock directly here.
-- A corrected invoice keeps the customer-facing invoice number while the old
-- version remains as a returned revision for audit/history.

CREATE OR REPLACE FUNCTION public.update_purchase_invoice(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_return jsonb;
  v_replacement jsonb;
  v_revision_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('purchases.manage') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ALLOWED',
      'detail', 'purchases.manage permission is required.'
    );
  END IF;

  -- Read first without taking a row lock so callers must pass branch access and
  -- lifecycle/editability checks before they are allowed to lock the invoice.
  SELECT *
  INTO v_purchase
  FROM public.purchases
  WHERE id = p_purchase_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Editing lifecycle states that are still awaiting approval/receiving would
  -- bypass their workflow. Completed invoices are corrected through a full
  -- reversal followed by a replacement in this same database transaction.
  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PURCHASE_EDIT_STATUS_NOT_ALLOWED',
      'detail', 'Only completed purchase invoices can be corrected here.'
    );
  END IF;

  -- Lock only after the caller has been authorized and the invoice is known to
  -- be editable. Re-read under the lock, then repeat critical checks to guard
  -- against a branch/status change between the initial read and lock acquisition.
  SELECT *
  INTO v_purchase
  FROM public.purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PURCHASE_EDIT_STATUS_NOT_ALLOWED',
      'detail', 'Only completed purchase invoices can be corrected here.'
    );
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_REQUIRED');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_ITEMS_REQUIRED');
  END IF;

  IF p_total IS NULL OR p_total < 0 OR p_subtotal IS NULL OR p_subtotal < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOTAL');
  END IF;

  -- Keep branch immutable. Warehouse may be corrected, but if supplied it must
  -- belong to the same branch. process_purchase performs its own validation too.
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.branch_id = v_purchase.branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  v_return := public.process_purchase_return(
    p_purchase_id => p_purchase_id,
    p_items => NULL,
    p_reason => 'Purchase invoice corrected'
  );

  IF COALESCE((v_return->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = COALESCE(v_return->>'detail', v_return->>'error', 'PURCHASE_REVERSAL_FAILED'),
      ERRCODE = 'P0001';
  END IF;

  -- Free the visible invoice number for the replacement while retaining the old
  -- returned row as an auditable revision. The suffix uses the row id so it is
  -- deterministic and unique without allocating another financial document no.
  v_revision_number := v_purchase.invoice_number || '-REV-' || substr(replace(p_purchase_id::text, '-', ''), 1, 8);
  UPDATE public.purchases
  SET invoice_number = v_revision_number
  WHERE id = p_purchase_id;

  v_replacement := public.process_purchase(
    p_invoice_number => v_purchase.invoice_number,
    p_supplier_id => p_supplier_id,
    p_branch_id => v_purchase.branch_id,
    p_warehouse_id => p_warehouse_id,
    p_subtotal => p_subtotal,
    p_discount_amount => COALESCE(p_discount_amount, 0),
    p_tax_amount => COALESCE(p_tax_amount, 0),
    p_total => p_total,
    p_paid_amount => COALESCE(p_paid_amount, 0),
    p_payment_method => p_payment_method,
    p_status => 'completed',
    p_notes => p_notes,
    p_items => p_items
  );

  IF COALESCE((v_replacement->>'success')::boolean, false) IS NOT TRUE THEN
    -- Raising after the successful reversal intentionally rolls back the entire
    -- outer transaction, including the reversal and revision-number change.
    RAISE EXCEPTION USING
      MESSAGE = COALESCE(v_replacement->>'detail', v_replacement->>'error', 'PURCHASE_REPLACEMENT_FAILED'),
      ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    auth.uid(),
    'update',
    'purchase',
    COALESCE((v_replacement->>'purchase_id')::uuid, p_purchase_id),
    jsonb_build_object(
      'previous_purchase_id', p_purchase_id,
      'previous_revision_number', v_revision_number,
      'invoice_number', v_purchase.invoice_number,
      'transactional_reversal', true
    ),
    v_purchase.branch_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_id', v_replacement->>'purchase_id',
    'previous_purchase_id', p_purchase_id,
    'invoice_number', v_purchase.invoice_number,
    'previous_revision_number', v_revision_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_invoice(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,jsonb) TO authenticated, service_role;
