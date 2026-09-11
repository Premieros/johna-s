-- Cross-branch warehouse transfers with raw-material support.
-- Source branch remains warehouse_transfers.branch_id for backwards compatibility.

ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS to_branch_id uuid REFERENCES public.branches(id) ON DELETE RESTRICT;

UPDATE public.warehouse_transfers wt
SET to_branch_id = w.branch_id
FROM public.warehouses w
WHERE w.id = wt.to_warehouse_id
  AND wt.to_branch_id IS NULL;

-- Cross-branch transfers were not supported by the previous RPC contract.
-- Refuse to guess a destination identity for any legacy/corrupt cross-branch
-- row; an operator must remediate it explicitly before this migration runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.warehouse_transfers wt
    LEFT JOIN public.warehouses fw ON fw.id = wt.from_warehouse_id
    LEFT JOIN public.warehouses tw ON tw.id = wt.to_warehouse_id
    WHERE fw.id IS NULL
       OR tw.id IS NULL
       OR fw.branch_id IS DISTINCT FROM wt.branch_id
       OR tw.branch_id IS DISTINCT FROM wt.to_branch_id
       OR wt.to_branch_id IS DISTINCT FROM wt.branch_id
  ) THEN
    RAISE EXCEPTION 'LEGACY_WAREHOUSE_TRANSFER_REQUIRES_EXPLICIT_REMEDIATION';
  END IF;
END $$;

ALTER TABLE public.warehouse_transfer_items
  ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT;

UPDATE public.warehouse_transfer_items
SET destination_product_id = product_id
WHERE product_id IS NOT NULL
  AND destination_product_id IS NULL;

ALTER TABLE public.warehouse_transfer_items
  DROP CONSTRAINT IF EXISTS warehouse_transfer_items_product_id_check,
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

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_to_branch_id ON public.warehouse_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_raw_material_id ON public.warehouse_transfer_items(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_destination_product_id ON public.warehouse_transfer_items(destination_product_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_destination_raw_material_id ON public.warehouse_transfer_items(destination_raw_material_id);

-- Either side may read an inter-branch transfer; mutation RPCs require access to BOTH sides.
DROP POLICY IF EXISTS auth_select_warehouse_transfers ON public.warehouse_transfers;
DROP POLICY IF EXISTS warehouse_transfers_branch_read ON public.warehouse_transfers;
CREATE POLICY warehouse_transfers_branch_read ON public.warehouse_transfers
FOR SELECT TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  OR (to_branch_id IS NOT NULL AND public.user_may_access_branch(to_branch_id))
);

DROP POLICY IF EXISTS auth_select_warehouse_transfer_items ON public.warehouse_transfer_items;
DROP POLICY IF EXISTS warehouse_transfer_items_branch_read ON public.warehouse_transfer_items;
CREATE POLICY warehouse_transfer_items_branch_read ON public.warehouse_transfer_items
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.warehouse_transfers wt
  WHERE wt.id = warehouse_transfer_items.transfer_id
    AND (
      public.user_may_access_branch(wt.branch_id)
      OR (wt.to_branch_id IS NOT NULL AND public.user_may_access_branch(wt.to_branch_id))
    )
));

-- All transfer mutations must pass through the atomic SECURITY DEFINER RPCs.
-- Direct DML could otherwise mark a transfer approved without moving stock,
-- or construct a source-only row that bypasses destination-branch access.
DROP POLICY IF EXISTS auth_insert_warehouse_transfers ON public.warehouse_transfers;
DROP POLICY IF EXISTS auth_update_warehouse_transfers ON public.warehouse_transfers;
DROP POLICY IF EXISTS auth_delete_warehouse_transfers ON public.warehouse_transfers;
CREATE POLICY warehouse_transfers_rpc_only_insert ON public.warehouse_transfers
FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY warehouse_transfers_rpc_only_update ON public.warehouse_transfers
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY warehouse_transfers_rpc_only_delete ON public.warehouse_transfers
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS auth_insert_warehouse_transfer_items ON public.warehouse_transfer_items;
DROP POLICY IF EXISTS auth_update_warehouse_transfer_items ON public.warehouse_transfer_items;
DROP POLICY IF EXISTS auth_delete_warehouse_transfer_items ON public.warehouse_transfer_items;
CREATE POLICY warehouse_transfer_items_rpc_only_insert ON public.warehouse_transfer_items
FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY warehouse_transfer_items_rpc_only_update ON public.warehouse_transfer_items
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY warehouse_transfer_items_rpc_only_delete ON public.warehouse_transfer_items
FOR DELETE TO authenticated USING (false);

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
  v_validated_item jsonb;
  v_validated_items jsonb := '[]'::jsonb;
  v_item_type text;
  v_source_id uuid;
  v_destination_id uuid;
  v_requested_destination_id uuid;
  v_qty numeric(14,4);
  v_unit_cost numeric(14,4);
  v_to_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.create') THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED');
  END IF;
  IF p_from_warehouse_id IS NULL OR p_to_warehouse_id IS NULL OR p_from_warehouse_id = p_to_warehouse_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_WAREHOUSES');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_from_warehouse_id AND branch_id = p_branch_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  SELECT branch_id INTO v_to_branch_id FROM public.warehouses WHERE id = p_to_warehouse_id AND is_active;
  IF v_to_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_WAREHOUSE_NOT_FOUND'); END IF;
  IF NOT public.user_may_access_branch(p_branch_id) OR NOT public.user_may_access_branch(v_to_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  -- Resolve every line before creating a header, so invalid input cannot leave partial transfers.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_type := COALESCE(NULLIF(v_item->>'item_type', ''), 'product');
    BEGIN
      v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
      v_unit_cost := COALESCE((v_item->>'unit_cost')::numeric, 0);
      v_source_id := COALESCE(NULLIF(v_item->>'item_id', '')::uuid, NULLIF(v_item->>'product_id', '')::uuid, NULLIF(v_item->>'raw_material_id', '')::uuid);
      v_requested_destination_id := NULLIF(v_item->>'destination_item_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM');
    END;
    IF v_source_id IS NULL OR v_qty <= 0 OR v_item_type NOT IN ('product', 'raw_material') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_ITEM');
    END IF;

    v_destination_id := NULL;
    IF v_item_type = 'product' THEN
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_source_id AND branch_id = p_branch_id AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_BRANCH_MISMATCH', 'product_id', v_source_id);
      END IF;

      IF p_branch_id = v_to_branch_id THEN
        IF v_requested_destination_id IS NOT NULL AND v_requested_destination_id <> v_source_id THEN
          RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_ITEM_BRANCH_MISMATCH', 'product_id', v_source_id);
        END IF;
        v_destination_id := v_source_id;
      ELSE
        IF v_requested_destination_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_ITEM_REQUIRED', 'product_id', v_source_id, 'destination_branch_id', v_to_branch_id);
        END IF;
        SELECT p.id INTO v_destination_id
        FROM public.products p
        WHERE p.id = v_requested_destination_id AND p.branch_id = v_to_branch_id AND p.is_active;
        IF v_destination_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_ITEM_BRANCH_MISMATCH', 'product_id', v_source_id, 'destination_item_id', v_requested_destination_id);
        END IF;
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE id = v_source_id AND branch_id = p_branch_id AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_BRANCH_MISMATCH', 'raw_material_id', v_source_id);
      END IF;
      IF p_branch_id = v_to_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED');
      END IF;
      IF v_requested_destination_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_ITEM_REQUIRED', 'raw_material_id', v_source_id, 'destination_branch_id', v_to_branch_id);
      END IF;
      SELECT r.id INTO v_destination_id
      FROM public.raw_materials r
      WHERE r.id = v_requested_destination_id AND r.branch_id = v_to_branch_id AND r.is_active;
      IF v_destination_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'DESTINATION_ITEM_BRANCH_MISMATCH', 'raw_material_id', v_source_id, 'destination_item_id', v_requested_destination_id);
      END IF;
    END IF;

    v_validated_items := v_validated_items || jsonb_build_array(jsonb_build_object(
      'item_type', v_item_type, 'source_id', v_source_id, 'destination_id', v_destination_id,
      'quantity', v_qty, 'unit_cost', v_unit_cost
    ));
  END LOOP;

  v_number := (public.next_document_number('transfer')->>'number')::text;
  INSERT INTO public.warehouse_transfers (transfer_number, from_warehouse_id, to_warehouse_id, branch_id, to_branch_id, reason, notes, requested_by)
  VALUES (v_number, p_from_warehouse_id, p_to_warehouse_id, p_branch_id, v_to_branch_id, p_reason, p_notes, auth.uid())
  RETURNING id INTO v_transfer_id;

  FOR v_validated_item IN SELECT * FROM jsonb_array_elements(v_validated_items) LOOP
    v_item_type := v_validated_item->>'item_type';
    v_source_id := (v_validated_item->>'source_id')::uuid;
    v_destination_id := (v_validated_item->>'destination_id')::uuid;
    v_qty := (v_validated_item->>'quantity')::numeric;
    v_unit_cost := (v_validated_item->>'unit_cost')::numeric;
    IF v_item_type = 'product' THEN
      INSERT INTO public.warehouse_transfer_items (transfer_id, product_id, destination_product_id, quantity, unit_cost)
      VALUES (v_transfer_id, v_source_id, v_destination_id, v_qty, v_unit_cost);
    ELSE
      INSERT INTO public.warehouse_transfer_items (transfer_id, raw_material_id, destination_raw_material_id, quantity, unit_cost)
      VALUES (v_transfer_id, v_source_id, v_destination_id, v_qty, v_unit_cost);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'transfer_number', v_number, 'source_branch_id', p_branch_id, 'destination_branch_id', v_to_branch_id);
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
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED'); END IF;

  SELECT wt.* INTO v_transfer
  FROM public.warehouse_transfers wt
  WHERE wt.id = p_transfer_id
    AND public.user_may_access_branch(wt.branch_id)
    AND public.user_may_access_branch(COALESCE(wt.to_branch_id, wt.branch_id))
  FOR UPDATE;
  IF v_transfer.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND'); END IF;
  IF v_transfer.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_transfer.from_warehouse_id AND branch_id = v_transfer.branch_id)
     OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_transfer.to_warehouse_id AND branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_BRANCH_MISMATCH');
  END IF;

  -- Preflight all lines before moving any stock.
  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_avail FROM public.inventory_batches
      WHERE product_id = v_item.product_id AND warehouse_id = v_transfer.from_warehouse_id AND branch_id = v_transfer.branch_id;
      IF v_avail < v_item.quantity THEN RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_STOCK', 'product_id', v_item.product_id, 'required', v_item.quantity, 'available', v_avail); END IF;
    ELSE
      SELECT COALESCE(quantity, 0) INTO v_avail FROM public.raw_material_inventory WHERE raw_material_id = v_item.raw_material_id AND branch_id = v_transfer.branch_id;
      v_avail := COALESCE(v_avail, 0);
      IF v_avail < v_item.quantity THEN RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_RAW_STOCK', 'raw_material_id', v_item.raw_material_id, 'required', v_item.quantity, 'available', v_avail); END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id ORDER BY id LOOP
    IF v_item.product_id IS NOT NULL THEN
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) AND v_item.destination_product_id = v_item.product_id THEN
        v_res := public._product_inv_move(v_item.product_id, v_transfer.from_warehouse_id, v_transfer.to_warehouse_id, v_transfer.branch_id, v_item.quantity, 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_res->>'success')::boolean, true) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_MOVE_FAILED product=% detail=%', v_item.product_id, v_res::text; END IF;
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN RAISE EXCEPTION 'TRANSFER_STOCK_RACE product=% shortage=%', v_item.product_id, v_short; END IF;
      ELSE
        v_res := public._product_inv_remove_fifo(v_item.product_id, v_transfer.from_warehouse_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_res->>'success')::boolean, true) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_REMOVE_FAILED product=% detail=%', v_item.product_id, v_res::text; END IF;
        v_short := COALESCE((v_res->>'shortage')::numeric, 0);
        IF v_short > 0 THEN RAISE EXCEPTION 'TRANSFER_STOCK_RACE product=% shortage=%', v_item.product_id, v_short; END IF;
        v_cost := COALESCE((v_res->>'avg_cost')::numeric, v_item.unit_cost, 0);
        v_add := public._product_inv_add(v_item.destination_product_id, v_transfer.to_warehouse_id, v_transfer.to_branch_id, v_item.quantity, v_cost, NULL, NULL, NULL, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
        IF COALESCE((v_add->>'success')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_DESTINATION_ADD_FAILED product=% detail=%', v_item.destination_product_id, v_add::text; END IF;
      END IF;
    ELSE
      IF v_transfer.branch_id = COALESCE(v_transfer.to_branch_id, v_transfer.branch_id) THEN RAISE EXCEPTION 'RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED'; END IF;
      v_res := public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_item.quantity, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
      IF COALESCE((v_res->>'success')::boolean, true) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_RAW_REMOVE_FAILED raw=% detail=%', v_item.raw_material_id, v_res::text; END IF;
      v_short := COALESCE((v_res->>'shortage')::numeric, 0);
      IF v_short > 0 THEN RAISE EXCEPTION 'TRANSFER_RAW_STOCK_RACE raw=% shortage=%', v_item.raw_material_id, v_short; END IF;
      v_cost := COALESCE((v_res->>'avg_cost')::numeric, v_item.unit_cost, 0);
      v_add := public._raw_add(v_item.destination_raw_material_id, v_transfer.to_branch_id, v_item.quantity, v_cost, NULL, NULL, NULL, 'transfer', 'warehouse_transfer', v_transfer.id, v_transfer.transfer_number, auth.uid());
      IF COALESCE((v_add->>'success')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'TRANSFER_DESTINATION_RAW_ADD_FAILED raw=% detail=%', v_item.destination_raw_material_id, v_add::text; END IF;
    END IF;
  END LOOP;

  UPDATE public.warehouse_transfers SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_transfer_id;
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
DECLARE v_transfer record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); END IF;
  IF NOT public.is_pos_admin() AND NOT public.can_permission('inventory.transfer.approve') THEN RETURN jsonb_build_object('success', false, 'error', 'NOT_ALLOWED'); END IF;
  SELECT wt.* INTO v_transfer
  FROM public.warehouse_transfers wt
  WHERE wt.id = p_transfer_id
    AND public.user_may_access_branch(wt.branch_id)
    AND public.user_may_access_branch(COALESCE(wt.to_branch_id, wt.branch_id))
  FOR UPDATE;
  IF v_transfer.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'TRANSFER_NOT_FOUND'); END IF;
  IF v_transfer.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS', 'status', v_transfer.status); END IF;
  UPDATE public.warehouse_transfers SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), rejection_reason = p_reason, updated_at = now() WHERE id = p_transfer_id;
  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
END;
$function$;
