-- Cross-branch warehouse transfers with raw-material support.
-- Source branch remains warehouse_transfers.branch_id for backwards compatibility.

ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS to_branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;

UPDATE public.warehouse_transfers wt
SET to_branch_id = w.branch_id
FROM public.warehouses w
WHERE w.id = wt.to_warehouse_id
  AND wt.to_branch_id IS NULL;

ALTER TABLE public.warehouse_transfer_items
  ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT;

UPDATE public.warehouse_transfer_items
SET destination_product_id = product_id
WHERE product_id IS NOT NULL
  AND destination_product_id IS NULL;

ALTER TABLE public.warehouse_transfer_items
  DROP CONSTRAINT IF EXISTS warehouse_transfer_items_source_kind_check,
  DROP CONSTRAINT IF EXISTS warehouse_transfer_items_destination_kind_check;

ALTER TABLE public.warehouse_transfer_items
  ADD CONSTRAINT warehouse_transfer_items_source_kind_check CHECK (
    (product_id IS NOT NULL AND raw_material_id IS NULL)
    OR (product_id IS NULL AND raw_material_id IS NOT NULL)
  ),
  ADD CONSTRAINT warehouse_transfer_items_destination_kind_check CHECK (
    (product_id IS NOT NULL AND destination_product_id IS NOT NULL AND destination_raw_material_id IS NULL)
    OR (raw_material_id IS NOT NULL AND destination_raw_material_id IS NOT NULL AND destination_product_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_to_branch_id
  ON public.warehouse_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_raw_material_id
  ON public.warehouse_transfer_items(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_destination_product_id
  ON public.warehouse_transfer_items(destination_product_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_destination_raw_material_id
  ON public.warehouse_transfer_items(destination_raw_material_id);

-- Allow an explicitly-authorized user on either side to read an inter-branch transfer.
-- Mutating RPCs below still require access to BOTH branches before stock can move.
DROP POLICY IF EXISTS auth_select_warehouse_transfers ON public.warehouse_transfers;
CREATE POLICY auth_select_warehouse_transfers ON public.warehouse_transfers
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  OR (to_branch_id IS NOT NULL AND public.user_may_access_branch(to_branch_id))
);

DROP POLICY IF EXISTS auth_select_warehouse_transfer_items ON public.warehouse_transfer_items;
CREATE POLICY auth_select_warehouse_transfer_items ON public.warehouse_transfer_items
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.warehouse_transfers wt
  WHERE wt.id = warehouse_transfer_items.transfer_id
    AND (
      public.user_may_access_branch(wt.branch_id)
      OR (wt.to_branch_id IS NOT NULL AND public.user_may_access_branch(wt.to_branch_id))
    )
));

CREATE OR REPLACE FUNCTION public.create_warehouse_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transfer_id uuid;
  v_number text;
  v_item jsonb;
  v_item_type text;
  v_source_id uuid;
  v_destination_id uuid;
  v_qty numeric(14,4);
  v_unit_cost numeric(14,4);
  v_to_branch_id uuid;
  v_source_product public.products%ROWTYPE;
  v_source_raw public.raw_materials%ROWTYPE;
  v_match_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.create') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
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
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  SELECT branch_id INTO v_to_branch_id
  FROM public.warehouses
  WHERE id = p_to_warehouse_id AND is_active;

  IF v_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_WAREHOUSE_NOT_FOUND');
  END IF;

  IF NOT public.user_may_access_branch(p_branch_id)
     OR NOT public.user_may_access_branch(v_to_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  v_number := (public.next_document_number('transfer')->>'number')::text;
  INSERT INTO public.warehouse_transfers
    (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, to_branch_id, reason, notes, requested_by)
  VALUES
    (v_number, p_from_warehouse_id, p_to_warehouse_id, p_branch_id, v_to_branch_id, p_reason, p_notes, auth.uid())
  RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_type := COALESCE(NULLIF(v_item->>'item_type', ''), 'product');
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
    BEGIN
      v_source_id := COALESCE(
        NULLIF(v_item->>'item_id', '')::uuid,
        NULLIF(v_item->>'product_id', '')::uuid,
        NULLIF(v_item->>'raw_material_id', '')::uuid
      );
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
    END;

    IF v_source_id IS NULL OR v_qty <= 0 OR v_item_type NOT IN ('product', 'raw_material') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM', 'item', v_item);
    END IF;

    IF v_item_type = 'product' THEN
      SELECT * INTO v_source_product
      FROM public.products
      WHERE id = v_source_id AND branch_id = p_branch_id AND is_active;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_BRANCH_MISMATCH', 'product_id', v_source_id);
      END IF;

      IF p_branch_id = v_to_branch_id THEN
        v_destination_id := v_source_id;
      ELSE
        SELECT count(*), min(p.id) INTO v_match_count, v_destination_id
        FROM public.products p
        WHERE p.branch_id = v_to_branch_id
          AND p.is_active
          AND (
            (NULLIF(btrim(v_source_product.sku), '') IS NOT NULL AND p.sku = v_source_product.sku)
            OR (NULLIF(btrim(v_source_product.barcode), '') IS NOT NULL AND p.barcode = v_source_product.barcode)
            OR lower(btrim(p.name)) = lower(btrim(v_source_product.name))
          );
        IF v_match_count <> 1 THEN
          RETURN jsonb_build_object('success', false, 'error',
            CASE WHEN v_match_count = 0 THEN 'DESTINATION_PRODUCT_NOT_FOUND' ELSE 'DESTINATION_PRODUCT_AMBIGUOUS' END,
            'product_id', v_source_id, 'destination_branch_id', v_to_branch_id);
        END IF;
      END IF;

      INSERT INTO public.warehouse_transfer_items
        (transfer_id, product_id, destination_product_id, quantity, unit_cost)
      VALUES
        (v_transfer_id, v_source_id, v_destination_id, v_qty, v_unit_cost);
    ELSE
      SELECT * INTO v_source_raw
      FROM public.raw_materials
      WHERE id = v_source_id AND branch_id = p_branch_id AND is_active;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_BRANCH_MISMATCH', 'raw_material_id', v_source_id);
      END IF;

      IF p_branch_id = v_to_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED');
      END IF;

      SELECT count(*), min(r.id) INTO v_match_count, v_destination_id
      FROM public.raw_materials r
      WHERE r.branch_id = v_to_branch_id
        AND r.is_active
        AND lower(btrim(r.name)) = lower(btrim(v_source_raw.name));
      IF v_match_count <> 1 THEN
        RETURN jsonb_build_object('success', false, 'error',
          CASE WHEN v_match_count = 0 THEN 'DESTINATION_RAW_MATERIAL_NOT_FOUND' ELSE 'DESTINATION_RAW_MATERIAL_AMBIGUOUS' END,
          'raw_material_id', v_source_id, 'destination_branch_id', v_to_branch_id);
      END IF;

      INSERT INTO public.warehouse_transfer_items
        (transfer_id, raw_material_id, destination_raw_material_id, quantity, unit_cost)
      VALUES
        (v_transfer_id, v_source_id, v_destination_id, v_qty, v_unit_cost);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_number,
    'source_branch_id', p_branch_id,
    'destination_branch_id', v_to_branch_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transfer record;
  v_item record;
  v_avail numeric(14,4);
  v_res jsonb;
  v_add jsonb;
  v_short numeric(14,4);
  v_cost numeric(14,4);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  SELECT wt.* INTO v_transfer
  FROM public.warehouse_transfers wt
  WHERE wt.id = p_transfer_id
  FOR UPDATE;

  IF v_transfer.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_transfer.branch_id)
     OR NOT public.user_may_access_branch(COALESCE(v_transfer.to_branch_id, v_transfer.branch_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_transfer.from_warehouse_id AND branch_id = v_transfer.branch_id)
     OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_transfer.to_warehouse_id AND branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  -- Preflight every line before moving anything.
  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_avail
      FROM public.inventory_batches
      WHERE product_id = v_item.product_id
        AND warehouse_id = v_transfer.from_warehouse_id
        AND branch_id = v_transfer.branch_id;
      IF v_avail < v_item.quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'product_id', v_item.product_id, 'required', v_item.quantity, 'available', v_avail);
      END IF;
    ELSE
      SELECT COALESCE(quantity, 0) INTO v_avail
      FROM public.raw_material_inventory
      WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id;
      v_avail := COALESCE(v_avail, 0);
      IF v_avail < v_item.quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW_STOCK', 'raw_material_id', v_item.raw_material_id, 'required', v_item.quantity, 'available', v_avail);
      END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id ORDER BY id LOOP
    IF v_item.product_id IS NOT NULL THEN
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id)
         AND v_item.destination_product_id = v_item.product_id THEN
        v_res := public._product_inv_move(
          v_item.product_id,
          v_transfer.from_warehouse_id,
          v_transfer.to_warehouse_id,
          v_transfer.branch_id,
          v_item.quantity,
          'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid()
        );
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN
          RAISE EXCEPTION 'TRANSFER_STOCK_RACE product=% shortage=%', v_item.product_id, v_short;
        END IF;
      ELSE
        v_res := public._product_inv_remove_fifo(
          v_item.product_id, v_transfer.from_warehouse_id, v_transfer.branch_id,
          v_item.quantity, 'warehouse_transfer_out', 'warehouse_transfer',
          v_transfer.id, v_transfer.transfer_number, auth.uid()
        );
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN
          RAISE EXCEPTION 'TRANSFER_STOCK_RACE product=% shortage=%', v_item.product_id, v_short;
        END IF;
        v_cost := COALESCE((v_res->>'avg_cost')::numeric, v_item.unit_cost, 0);
        v_add := public._product_inv_add(
          v_item.destination_product_id, v_transfer.to_warehouse_id, v_transfer.to_branch_id,
          v_item.quantity, v_cost, NULL, NULL, NULL,
          'warehouse_transfer_in', 'warehouse_transfer', v_transfer.id,
          v_transfer.transfer_number, auth.uid()
        );
        IF COALESCE((v_add->>'success')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'TRANSFER_DESTINATION_ADD_FAILED product=% detail=%', v_item.destination_product_id, v_add::text;
        END IF;
      END IF;
    ELSE
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED');
      END IF;
      v_res := public._raw_remove_fifo(
        v_item.raw_material_id, v_transfer.branch_id, v_item.quantity,
        'warehouse_transfer_out', 'warehouse_transfer', v_transfer.id,
        v_transfer.transfer_number, auth.uid()
      );
      v_short := COALESCE((v_res->>'shortage')::numeric, 0);
      IF v_short > 0 THEN
        RAISE EXCEPTION 'TRANSFER_RAW_STOCK_RACE raw=% shortage=%', v_item.raw_material_id, v_short;
      END IF;
      v_cost := COALESCE((v_res->>'avg_cost')::numeric, v_item.unit_cost, 0);
      v_add := public._raw_add(
        v_item.destination_raw_material_id, v_transfer.to_branch_id, v_item.quantity,
        v_cost, NULL, NULL, NULL, 'warehouse_transfer_in', 'warehouse_transfer',
        v_transfer.id, v_transfer.transfer_number, auth.uid()
      );
      IF COALESCE((v_add->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'TRANSFER_DESTINATION_RAW_ADD_FAILED raw=% detail=%', v_item.destination_raw_material_id, v_add::text;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.warehouse_transfers
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id, 'transfer_number', v_transfer.transfer_number);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_warehouse_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transfer record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;

  SELECT wt.* INTO v_transfer
  FROM public.warehouse_transfers wt
  WHERE wt.id = p_transfer_id
  FOR UPDATE;

  IF v_transfer.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_transfer.branch_id)
     OR NOT public.user_may_access_branch(COALESCE(v_transfer.to_branch_id, v_transfer.branch_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status);
  END IF;

  UPDATE public.warehouse_transfers
  SET status = 'rejected', approved_by = auth.uid(), approved_at = now(),
      rejection_reason = p_reason, updated_at = now()
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;
