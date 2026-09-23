BEGIN;

-- Purchase payment-source integrity.
-- Forward-only guardrail: no historical purchase/journal rows are rewritten.
-- Printing is intentionally out of scope.
--
-- Canonical settlement rules:
--   cash   => fully paid from branch cash (1000), never bank.
--   credit => paid_amount = 0 and full payable (2000), never bank.
--   bank/transfer/card => require an explicit treasury account through the
--                         source-aware supplier-payment RPC; never infer 1010.

-- ---------------------------------------------------------------------------
-- 1) process_purchase: make settlement semantics authoritative in the database.
--    Keep all existing inventory/UOM behavior and patch only authorization +
--    settlement routing so later fixes are preserved.
-- ---------------------------------------------------------------------------
DO $patch_process_purchase$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.process_purchase(text,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,text,jsonb)'
  );
  v_def text;
  v_old text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: process_purchase/13 missing';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  -- Permission-First + multi-branch authorization before any write.
  v_old := $old$
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    -- Only admins, branch managers and warehouse managers create purchases
    IF NOT public.can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchases requires the purchases.manage permission.');
    END IF;

    -- Branch isolation (mirror of RLS on purchases)
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND p_branch_id IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;
$old$;

  v_new := $new$
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    IF NOT public.can_permission('purchases.manage') THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchases requires the purchases.manage permission.'
      );
    END IF;

    IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    IF p_total IS NULL OR p_total < 0 OR p_subtotal IS NULL OR p_subtotal < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOTAL');
    END IF;

    IF lower(btrim(COALESCE(p_payment_method, 'cash'))) NOT IN ('cash', 'credit') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TREASURY_ACCOUNT_REQUIRED',
        'detail', 'Non-cash purchases require an explicitly selected treasury account.'
      );
    END IF;

    IF p_supplier_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.suppliers s
      WHERE s.id = p_supplier_id
        AND s.branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SUPPLIER_NOT_IN_BRANCH');
    END IF;

    IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = p_warehouse_id
        AND w.branch_id = p_branch_id
        AND w.is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
    END IF;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: process_purchase authorization marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  -- Persist the server-authoritative settlement, never caller-supplied credit paid_amount.
  v_old := $old$
      p_subtotal, p_discount_amount, p_tax_amount, p_total, p_paid_amount, p_payment_method, p_status, p_notes)
$old$;
  v_new := $new$
      p_subtotal, p_discount_amount, p_tax_amount, p_total,
      CASE
        WHEN lower(btrim(COALESCE(p_payment_method, 'cash'))) = 'cash'
          THEN round(COALESCE(p_total, 0), 2)
        ELSE 0
      END,
      lower(btrim(COALESCE(p_payment_method, 'cash'))),
      p_status, p_notes)
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: process_purchase insert marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
      v_paid := round(COALESCE(p_paid_amount, 0), 2);
      v_ap := round(COALESCE(p_total, 0) - v_paid, 2);
$old$;
  v_new := $new$
      v_paid := CASE
        WHEN lower(btrim(COALESCE(p_payment_method, 'cash'))) = 'cash'
          THEN round(COALESCE(p_total, 0), 2)
        ELSE 0
      END;
      v_ap := round(COALESCE(p_total, 0) - v_paid, 2);
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: process_purchase paid/AP marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
        v_lines := v_lines || jsonb_build_object('account_key', CASE WHEN COALESCE(p_payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END,
          'debit', 0, 'credit', v_paid, 'note', p_invoice_number);
$old$;
  v_new := $new$
        -- v_paid can only be positive for a canonical cash purchase.
        v_lines := v_lines || jsonb_build_object(
          'account_key', 'cash',
          'debit', 0, 'credit', v_paid, 'note', p_invoice_number
        );
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: process_purchase bank-routing marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  EXECUTE v_def;
END
$patch_process_purchase$;

REVOKE ALL ON FUNCTION public.process_purchase(text,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,text,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_purchase(text,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,text,text,text,jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) create_purchase_order: PO creation has no treasury_account_id. Therefore it
--    may only declare cash or credit; ambiguous bank-like methods are rejected.
-- ---------------------------------------------------------------------------
DO $patch_create_po$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.create_purchase_order(uuid,uuid,uuid,text,text,jsonb,uuid)'
  );
  v_def text;
  v_old text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: create_purchase_order/7 missing';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_old := $old$
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchase orders requires the purchases.manage permission.');
    END IF;
$old$;
  v_new := $new$
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('purchases.manage') THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'NOT_ALLOWED',
        'detail', 'Creating purchase orders requires the purchases.manage permission.'
      );
    END IF;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: create_purchase_order permission marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
    IF p_branch_id IS NULL OR p_supplier_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_SUPPLIER_BRANCH');
    END IF;
$old$;
  v_new := $new$
    IF p_branch_id IS NULL OR p_supplier_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'MISSING_SUPPLIER_BRANCH');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF lower(btrim(COALESCE(p_payment_method, 'cash'))) NOT IN ('cash', 'credit') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TREASURY_ACCOUNT_REQUIRED',
        'detail', 'Non-cash purchase orders require an explicitly selected treasury account.'
      );
    END IF;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: create_purchase_order branch/payment marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  -- Remove the obsolete primary-branch-only check. user_may_access_branch above
  -- is the canonical multi-branch RLS-aligned guard.
  v_old := $old$
    IF NOT is_pos_admin() THEN
      SELECT branch_id INTO v_user_branch FROM public.users WHERE id = auth.uid();
      IF v_user_branch IS NOT NULL AND v_user_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
    END IF;
$old$;
  IF position(v_old IN v_def) > 0 THEN
    v_def := replace(v_def, v_old, E'');
  END IF;

  v_old := $old$0, 0, 0, 0, 0, COALESCE(p_payment_method, 'cash'), 'draft', p_notes, v_request_id)$old$;
  v_new := $new$0, 0, 0, 0, 0, lower(btrim(COALESCE(p_payment_method, 'cash'))), 'draft', p_notes, v_request_id)$new$;
  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: create_purchase_order payment persistence marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  EXECUTE v_def;
END
$patch_create_po$;

REVOKE ALL ON FUNCTION public.create_purchase_order(uuid,uuid,uuid,text,text,jsonb,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid,uuid,uuid,text,text,jsonb,uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) receive_purchase_order: authorize before locking, normalize cash/credit,
--    and remove the remaining implicit non-cash => bank posting.
-- ---------------------------------------------------------------------------
DO $patch_receive_po$
DECLARE
  v_oid regprocedure := to_regprocedure('public.receive_purchase_order(uuid,jsonb)');
  v_def text;
  v_old text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: receive_purchase_order/2 missing';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  v_old := $old$
    IF NOT is_pos_admin() AND NOT can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
$old$;
  v_new := $new$
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('purchases.manage') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
    END IF;
$new$;
  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: receive_purchase_order permission marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF v_purchase.status NOT IN ('approved', 'submitted', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_RECEIVABLE', 'status', v_purchase.status);
    END IF;
    IF NOT is_pos_admin() AND NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
$old$;
  v_new := $new$
    -- Permission-First: inspect ownership before taking a row lock.
    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id;
    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF v_purchase.status NOT IN ('approved', 'submitted', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_RECEIVABLE', 'status', v_purchase.status);
    END IF;
    IF lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))) NOT IN ('cash', 'credit') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'TREASURY_ACCOUNT_REQUIRED',
        'detail', 'Non-cash purchase orders require an explicitly selected treasury account.'
      );
    END IF;

    SELECT * INTO v_purchase
    FROM public.purchases
    WHERE id = p_purchase_id
    FOR UPDATE;

    IF v_purchase.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_FOUND');
    END IF;
    IF NOT public.user_may_access_branch(v_purchase.branch_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
    END IF;
    IF v_purchase.status NOT IN ('approved', 'submitted', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', 'NOT_RECEIVABLE', 'status', v_purchase.status);
    END IF;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: receive_purchase_order lock/branch marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
      v_paid := round(LEAST(GREATEST(COALESCE(v_purchase.paid_amount, 0), 0), COALESCE(v_purchase.total, 0)), 2);
      v_ap := round(COALESCE(v_purchase.total, 0) - v_paid, 2);
$old$;
  v_new := $new$
      v_paid := CASE
        WHEN lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))) = 'cash'
          THEN round(COALESCE(v_purchase.total, 0), 2)
        ELSE 0
      END;
      v_ap := round(COALESCE(v_purchase.total, 0) - v_paid, 2);
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: receive_purchase_order paid/AP marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
        v_lines := v_lines || jsonb_build_object('account_key', CASE WHEN COALESCE(v_purchase.payment_method, 'cash') = 'cash' THEN 'cash' ELSE 'bank' END,
          'debit', 0, 'credit', v_paid, 'note', v_purchase.invoice_number);
$old$;
  v_new := $new$
        -- v_paid can only be positive for a canonical cash PO.
        v_lines := v_lines || jsonb_build_object(
          'account_key', 'cash',
          'debit', 0, 'credit', v_paid, 'note', v_purchase.invoice_number
        );
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: receive_purchase_order bank-routing marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  v_old := $old$
    UPDATE public.purchases SET status = CASE WHEN v_fully_received THEN 'completed' ELSE 'partial' END
    WHERE id = p_purchase_id;
$old$;
  v_new := $new$
    UPDATE public.purchases
    SET status = CASE WHEN v_fully_received THEN 'completed' ELSE 'partial' END,
        payment_method = lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))),
        paid_amount = CASE
          WHEN NOT v_fully_received THEN paid_amount
          WHEN lower(btrim(COALESCE(v_purchase.payment_method, 'cash'))) = 'cash'
            THEN round(COALESCE(total, 0), 2)
          ELSE 0
        END
    WHERE id = p_purchase_id;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'PURCHASE_PAYMENT_SOURCE_INTEGRITY: receive_purchase_order final update marker changed';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  EXECUTE v_def;
END
$patch_receive_po$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid,jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Legacy supplier-payment compatibility path: never guess a bank account.
--    Current UI already uses pay_supplier_from_treasury with an explicit source.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_supplier(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash',
  p_purchase_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_treasury_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.can_permission('procurement.payment.create') THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'NOT_ALLOWED',
      'detail', 'Supplier payments require procurement.payment.create.'
    );
  END IF;

  IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF lower(btrim(COALESCE(p_payment_method, 'cash'))) <> 'cash' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'TREASURY_ACCOUNT_REQUIRED',
      'detail', 'Select the actual treasury/bank account and use pay_supplier_from_treasury.'
    );
  END IF;

  SELECT t.id
    INTO v_treasury_account_id
  FROM public.treasury_accounts t
  WHERE t.branch_id = p_branch_id
    AND t.scope = 'branch'
    AND t.kind = 'branch_cash'
    AND t.is_active
  ORDER BY t.is_primary DESC, t.created_at ASC, t.id
  LIMIT 1;

  IF v_treasury_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TREASURY_ACCOUNT_REQUIRED');
  END IF;

  RETURN public.pay_supplier_from_treasury(
    p_supplier_id,
    p_branch_id,
    p_amount,
    v_treasury_account_id,
    p_purchase_id,
    p_notes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_supplier(uuid,uuid,numeric,text,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier(uuid,uuid,numeric,text,uuid,text)
  TO authenticated, service_role;

-- No historical correction here. Existing 1010 purchase journals remain
-- untouched for a separately reviewed reconciliation after Full Verify Green.

NOTIFY pgrst, 'reload schema';
COMMIT;
