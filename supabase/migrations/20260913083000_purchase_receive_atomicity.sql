-- Purchases phase: keep receive_purchase_order failure paths atomic.
--
-- The legacy receive function created purchase_receipts / purchase_receipt_items
-- before discovering that an order had no usable warehouse. Returning a json
-- error does not roll back earlier statements in the function, so a failed
-- receive could leave an orphan GRN. Validate the canonical PO warehouse before
-- allocating a receipt number or writing any receipt/inventory rows.

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'receive_purchase_order'
    AND pg_get_function_identity_arguments(p.oid) = 'p_purchase_id uuid, p_receipt_items jsonb';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'receive_purchase_order target not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  v_old := $old$    v_number := (public.next_document_number('purchase_receipt')->>'number')::text;
$old$;

  v_new := $new$    -- Preflight the canonical PO warehouse before any GRN write.  The
    -- inventory helpers already require branch-local active warehouses; doing
    -- this here keeps JSON failure responses side-effect free.
    IF v_purchase.warehouse_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_REQUIRED',
        'detail', 'Select a warehouse before receiving this purchase order.'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = v_purchase.warehouse_id
        AND w.branch_id = v_purchase.branch_id
        AND w.is_active
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WAREHOUSE_BRANCH_MISMATCH',
        'warehouse_id', v_purchase.warehouse_id,
        'branch_id', v_purchase.branch_id
      );
    END IF;

    v_number := (public.next_document_number('purchase_receipt')->>'number')::text;
$new$;

  IF position(v_new IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'receive_purchase_order receipt-number marker changed unexpectedly';
    END IF;
    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
  END IF;
END
$patch$;

NOTIFY pgrst, 'reload schema';
