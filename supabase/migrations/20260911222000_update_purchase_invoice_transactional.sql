-- Transactional correction for completed purchase invoices.
-- The existing purchase-return and purchase-create contracts remain the only
-- writers of inventory/accounting effects. We never mutate stock directly here.
-- A corrected invoice keeps the customer-facing invoice number while the old
-- version remains as a returned revision for audit/history.

-- Stage B made raw FIFO warehouse-explicit. The canonical purchase-return RPC
-- still calls the locked legacy signature, so teach that compatibility bridge
-- to resolve the warehouse from its authoritative purchase document. This
-- keeps process_purchase_return as the sole reversal writer and avoids any
-- direct inventory mutation in update_purchase_invoice.
CREATE OR REPLACE FUNCTION public._raw_remove_fifo(
  p_raw_material_id uuid,
  p_branch_id uuid,
  p_qty numeric,
  p_entry_type text DEFAULT 'production',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $bridge$
DECLARE
  v_warehouse_id uuid;
  v_qty numeric := p_qty;
  v_purchase_unit text;
  v_purchase_cost numeric;
  v_norm jsonb;
BEGIN
  IF p_reference_type = 'warehouse_transfer' AND p_reference_id IS NOT NULL THEN
    SELECT wt.from_warehouse_id INTO v_warehouse_id
    FROM public.warehouse_transfers wt
    WHERE wt.id = p_reference_id AND wt.branch_id = p_branch_id;
  ELSIF p_reference_type = 'sale' AND p_reference_id IS NOT NULL THEN
    SELECT s.warehouse_id INTO v_warehouse_id
    FROM public.sales s WHERE s.id = p_reference_id AND s.branch_id = p_branch_id;
  ELSIF p_reference_type = 'production' AND p_reference_id IS NOT NULL THEN
    SELECT iup.warehouse_id INTO v_warehouse_id
    FROM public.inventory_unit_productions iup
    WHERE iup.id = p_reference_id AND iup.branch_id = p_branch_id;
  ELSIF p_reference_type = 'purchase_return' AND p_reference_id IS NOT NULL THEN
    SELECT p.warehouse_id INTO v_warehouse_id
    FROM public.purchases p
    WHERE p.id = p_reference_id AND p.branch_id = p_branch_id;

    -- purchase_items retain the invoice UOM (for example kg), while raw stock
    -- and its FIFO batches use the material's base UOM (for example g).
    SELECT pi.unit_name, pi.unit_cost
      INTO v_purchase_unit, v_purchase_cost
    FROM public.purchase_items pi
    WHERE pi.purchase_id = p_reference_id
      AND pi.raw_material_id = p_raw_material_id
    ORDER BY pi.created_at DESC NULLS LAST, pi.id DESC
    LIMIT 1;

    IF FOUND THEN
      v_norm := public._normalize_raw_purchase_uom(
        p_raw_material_id,
        p_qty,
        COALESCE(v_purchase_cost, 0),
        v_purchase_unit
      );
      IF COALESCE((v_norm->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_norm; END IF;
      v_qty := (v_norm->>'stock_quantity')::numeric;
    END IF;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_REQUIRED', 'shortage', p_qty);
  END IF;

  RETURN public._raw_remove_fifo(
    p_raw_material_id, p_branch_id, v_warehouse_id, v_qty,
    p_entry_type, p_reference_type, p_reference_id, p_reference_number, p_created_by
  );
END;
$bridge$;

REVOKE ALL ON FUNCTION public._raw_remove_fifo(uuid,uuid,numeric,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._raw_remove_fifo(uuid,uuid,numeric,text,text,uuid,text,uuid) TO service_role, postgres;

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
