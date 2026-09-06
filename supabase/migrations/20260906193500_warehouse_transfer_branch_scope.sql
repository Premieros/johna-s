-- QA batch 2: warehouse-transfer SECURITY DEFINER boundaries must be branch-safe.
-- Prevent cross-branch warehouse/product injection and cross-branch approval/oracles.

CREATE OR REPLACE FUNCTION public.create_warehouse_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_reason text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_transfer_id uuid;
  v_number text;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(14,4);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.create') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF p_from_warehouse_id IS NULL OR p_to_warehouse_id IS NULL OR p_from_warehouse_id = p_to_warehouse_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_WAREHOUSES');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.warehouses
       WHERE id = p_from_warehouse_id AND branch_id = p_branch_id AND is_active
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.warehouses
       WHERE id = p_to_warehouse_id AND branch_id = p_branch_id AND is_active
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  -- Validate every item before creating the transfer header so invalid input
  -- never leaves a partial transfer, even when the caller handles JSON errors.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
    END;

    IF v_product_id IS NULL OR v_qty <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = v_product_id AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_BRANCH_MISMATCH', 'product_id', v_product_id);
    END IF;
  END LOOP;

  v_number := (public.next_document_number('transfer')->>'number')::text;

  INSERT INTO public.warehouse_transfers (
    transfer_number, from_warehouse_id, to_warehouse_id, branch_id,
    reason, notes, requested_by
  ) VALUES (
    v_number, p_from_warehouse_id, p_to_warehouse_id, p_branch_id,
    p_reason, p_notes, auth.uid()
  ) RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, quantity, unit_cost)
    VALUES (v_transfer_id, v_product_id, v_qty, COALESCE((v_item->>'unit_cost')::numeric, 0));
  END LOOP;

  RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'transfer_number', v_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_transfer record;
  v_item record;
  v_avail numeric(14,4);
  v_res jsonb;
  v_short numeric(14,4);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  -- Scope the lookup itself to avoid a cross-branch existence/status oracle.
  SELECT * INTO v_transfer
  FROM public.warehouse_transfers
  WHERE id = p_transfer_id
    AND public.user_may_access_branch(branch_id)
  FOR UPDATE;

  IF v_transfer.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status);
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.warehouses
       WHERE id = v_transfer.from_warehouse_id AND branch_id = v_transfer.branch_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.warehouses
       WHERE id = v_transfer.to_warehouse_id AND branch_id = v_transfer.branch_id
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  FOR v_item IN
    SELECT wti.*
    FROM public.warehouse_transfer_items wti
    JOIN public.products p ON p.id = wti.product_id AND p.branch_id = v_transfer.branch_id
    WHERE wti.transfer_id = p_transfer_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_avail
    FROM public.inventory_batches
    WHERE product_id = v_item.product_id
      AND warehouse_id = v_transfer.from_warehouse_id;
    IF v_avail < v_item.quantity THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
        'product_id', v_item.product_id, 'required', v_item.quantity, 'available', v_avail);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.warehouse_transfer_items wti
    LEFT JOIN public.products p
      ON p.id = wti.product_id AND p.branch_id = v_transfer.branch_id
    WHERE wti.transfer_id = p_transfer_id AND p.id IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_BRANCH_MISMATCH');
  END IF;

  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    v_res := public._product_inv_move(
      v_item.product_id, v_transfer.from_warehouse_id, v_transfer.to_warehouse_id,
      v_transfer.branch_id, v_item.quantity, 'warehouse_transfer', v_transfer.id,
      v_transfer.transfer_number, auth.uid()
    );
    v_short := (v_res->>'shortage')::numeric;
    IF v_short > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK',
        'product_id', v_item.product_id, 'shortage', v_short);
    END IF;
  END LOOP;

  UPDATE public.warehouse_transfers
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'transfer_number', v_transfer.transfer_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;
