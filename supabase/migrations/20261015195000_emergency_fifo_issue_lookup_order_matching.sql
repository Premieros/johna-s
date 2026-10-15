-- Emergency follow-up: preserve values and remove proven repeated work.
SET lock_timeout = '2s';
SET statement_timeout = '5s';
DO $guard$ BEGIN
  IF md5(pg_get_functiondef('public._raw_last_known_fifo_cost(uuid,uuid,uuid)'::regprocedure)) <> '6e70ec55b033454f4084266b13651cf7'
     OR md5(pg_get_functiondef('public.update_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text)'::regprocedure)) <> '4f98bda4ad3d8bb4b060abb792d4f3f5' THEN
    RAISE EXCEPTION 'EMERGENCY_FOLLOWUP_BASELINE_MISMATCH';
  END IF;
END $guard$;

-- Only real negative priced issues enter this index. Purchase rows and
-- synthetic OV debt rows do not; no receipt-history index is activated.
CREATE INDEX idx_inventory_ledger_fifo_known_cost_recent
  ON public.inventory_ledger
  (raw_material_id, branch_id, warehouse_id, created_at DESC NULLS LAST, id DESC)
  INCLUDE (unit_cost)
  WHERE quantity < 0 AND COALESCE(unit_cost,0) > 0
    AND COALESCE(batch_number,'') NOT LIKE 'OV-%';

CREATE OR REPLACE FUNCTION public._raw_last_known_fifo_cost(p_raw_material_id uuid, p_branch_id uuid, p_warehouse_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH last_fifo_issue AS (
    SELECT il.unit_cost::numeric AS unit_cost, il.created_at, il.id::text AS tie
    FROM public.inventory_ledger il
    WHERE il.raw_material_id = p_raw_material_id
      AND il.branch_id = p_branch_id
      AND il.warehouse_id = p_warehouse_id
      AND il.quantity < 0
      AND COALESCE(il.unit_cost, 0) > 0
      AND COALESCE(il.batch_number, '') NOT LIKE 'OV-%'
    ORDER BY il.created_at DESC NULLS LAST, il.id DESC
    LIMIT 1
  ),
  last_receipt_ledger AS (
    SELECT il.unit_cost::numeric AS unit_cost, il.created_at, il.id::text AS tie
    FROM public.inventory_ledger il
    WHERE il.raw_material_id = p_raw_material_id
      AND il.branch_id = p_branch_id
      AND il.warehouse_id = p_warehouse_id
      AND il.quantity > 0
      AND COALESCE(il.unit_cost, 0) > 0
      AND (
        COALESCE(il.entry_type, '') = 'purchase'
        OR COALESCE(il.reference_type, '') IN ('purchase', 'purchase_receipt')
      )
    ORDER BY il.created_at DESC NULLS LAST, il.id DESC
    LIMIT 1
  ),
  last_real_batch AS (
    SELECT b.unit_cost::numeric AS unit_cost, b.created_at, b.id::text AS tie
    FROM public.raw_material_batches b
    WHERE b.raw_material_id = p_raw_material_id
      AND b.branch_id = p_branch_id
      AND b.warehouse_id = p_warehouse_id
      AND COALESCE(b.unit_cost, 0) > 0
      AND COALESCE(b.source_type, '') NOT LIKE '%_oversold'
    ORDER BY b.created_at DESC NULLS LAST, b.id DESC
    LIMIT 1
  ),
  default_price AS (
    SELECT rm.default_cost::numeric AS unit_cost,
           '-infinity'::timestamptz AS created_at,
           rm.id::text AS tie
    FROM public.raw_materials rm
    WHERE rm.id = p_raw_material_id
      AND rm.branch_id = p_branch_id
      AND COALESCE(rm.default_cost, 0) > 0
    LIMIT 1
  )
  -- Each source already selects its single latest positive price. COALESCE
  -- stops once the authoritative higher-priority source is found.
  SELECT COALESCE(
    (SELECT unit_cost FROM last_fifo_issue),
    (SELECT unit_cost FROM last_receipt_ledger),
    (SELECT unit_cost FROM last_real_batch),
    (SELECT unit_cost FROM default_price),
    0
  )::numeric;
$function$
;
CREATE OR REPLACE FUNCTION public.update_order(p_order_id uuid, p_order_type text DEFAULT 'dine_in'::text, p_table_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_subtotal numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT 'amount'::text, p_tax_amount numeric DEFAULT 0, p_total numeric DEFAULT 0, p_status text DEFAULT 'held'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_old_table uuid;
  v_old_status text;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_matched_id uuid;
  v_matched_ids uuid[] := ARRAY[]::uuid[];
  v_requested_item_id uuid;
  v_owner_id uuid;
  v_sent_quantity numeric(14,4);
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;
    IF p_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
    END IF;
    SELECT branch_id, table_id, status, cashier_id
    INTO v_branch_id, v_old_table, v_old_status, v_owner_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    IF v_old_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE',
        'detail', 'Only open or held orders can be edited.');
    END IF;
    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
      END IF;
      IF NOT public.can_permission('pos.order.edit') THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.edit');
      END IF;
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF v_owner_id IS DISTINCT FROM v_uid AND NOT public.can_manage_other_pos_orders() THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
      END IF;
    END IF;
    IF v_old_table IS NOT NULL AND p_table_id IS NULL AND COALESCE(p_order_type, 'dine_in') = 'dine_in' THEN
      p_table_id := v_old_table;
    END IF;
    IF (v_old_table IS NOT NULL OR p_table_id IS NOT NULL) AND COALESCE(p_order_type, 'dine_in') <> 'dine_in' THEN
      RETURN jsonb_build_object('success', false,'error', 'TABLE_ORDER_TYPE_MISMATCH','detail', 'A table-bound order must remain dine_in during ordinary saves.');
    END IF;
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = v_branch_id AND is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND branch_id = v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
      END IF;
    END LOOP;
    UPDATE public.orders SET
      order_type = COALESCE(p_order_type, order_type),
      table_id = p_table_id,
      customer_id = p_customer_id,
      guest_count = p_guest_count,
      notes = p_notes,
      subtotal = COALESCE(p_subtotal, 0),
      discount_amount = COALESCE(p_discount_amount, 0),
      discount_type = COALESCE(p_discount_type, 'amount'),
      tax_amount = COALESCE(p_tax_amount, 0),
      total = COALESCE(p_total, 0),
      status = p_status,
      updated_at = now()
    WHERE id = p_order_id;
    -- Per-call matching needs no temporary DDL or schema-cache notification.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
      v_matched_id := NULL;
      v_requested_item_id := NULLIF(v_item->>'order_item_id', '')::uuid;
      IF v_requested_item_id IS NOT NULL THEN
        SELECT oi.id INTO v_matched_id
        FROM public.order_items oi
        WHERE oi.id = v_requested_item_id
          AND oi.order_id = p_order_id
          AND oi.product_id = v_product_id
          AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
          AND oi.unit_price = COALESCE((v_item->>'unit_price')::numeric, oi.unit_price)
          AND ARRAY(SELECT x::uuid FROM unnest(COALESCE(oi.modifier_option_ids, ARRAY[]::uuid[])) x ORDER BY x::text)
              = ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)) ORDER BY value)
          AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
          AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
          AND COALESCE(oi.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
          AND NOT (oi.id = ANY(v_matched_ids));
        IF v_matched_id IS NULL THEN
          RETURN jsonb_build_object('success', false,'error', 'ORDER_ITEM_IDENTITY_MISMATCH','order_item_id', v_requested_item_id);
        END IF;
      ELSE
        SELECT oi.id INTO v_matched_id
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
          AND oi.product_id = v_product_id
          AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
          AND oi.unit_price = COALESCE((v_item->>'unit_price')::numeric, oi.unit_price)
          AND ARRAY(SELECT x::uuid FROM unnest(COALESCE(oi.modifier_option_ids, ARRAY[]::uuid[])) x ORDER BY x::text)
              = ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)) ORDER BY value)
          AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
          AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
          AND COALESCE(oi.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
          AND NOT (oi.id = ANY(v_matched_ids))
        ORDER BY oi.id LIMIT 1;
      END IF;
      IF v_matched_id IS NOT NULL THEN
        SELECT COALESCE(s.sent_quantity, 0) INTO v_sent_quantity
        FROM public.order_items oi
        LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
        WHERE oi.id = v_matched_id;
        IF v_quantity + 0.000001 < COALESCE(v_sent_quantity, 0) THEN
          RETURN jsonb_build_object('success', false,'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
            'detail', 'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path for already-sent quantity',
            'order_item_id', v_matched_id,'sent_quantity', v_sent_quantity);
        END IF;
        UPDATE public.order_items SET
          quantity = v_quantity,
          total = COALESCE((v_item->>'total')::numeric, 0),
          notes = NULLIF(v_item->>'notes', '')
        WHERE id = v_matched_id;
        v_matched_ids := array_append(v_matched_ids, v_matched_id);
      ELSE
        IF v_requested_item_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM public.order_items existing
             JOIN public.order_kitchen_sends s ON s.order_item_id = existing.id
             WHERE existing.order_id = p_order_id
               AND existing.product_id = v_product_id
               AND existing.unit_name = COALESCE(v_item->>'unit_name', 'piece')
               AND existing.unit_price = COALESCE((v_item->>'unit_price')::numeric, existing.unit_price)
               AND ARRAY(SELECT x::uuid FROM unnest(COALESCE(existing.modifier_option_ids, ARRAY[]::uuid[])) x ORDER BY x::text)
                   = ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)) ORDER BY value)
               AND existing.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, existing.discount_amount)
               AND existing.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, existing.bonus_quantity)
               AND COALESCE(existing.notes, '') = COALESCE(NULLIF(v_item->>'notes', ''), '')
           ) THEN
          RETURN jsonb_build_object('success', false,'error', 'STALE_CLIENT_DUPLICATE_LINE','detail', 'Reload the POS before adding this item again.');
        END IF;
        INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price,
          discount_amount, bonus_quantity, total, modifier_option_ids, notes)
        VALUES (p_order_id, v_product_id,COALESCE(v_item->>'unit_name', 'piece'),v_quantity,
          COALESCE((v_item->>'unit_price')::numeric, 0),COALESCE((v_item->>'discount_amount')::numeric, 0),
          COALESCE((v_item->>'bonus_quantity')::numeric, 0),COALESCE((v_item->>'total')::numeric, 0),
          ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))),
          NULLIF(v_item->>'notes', ''))
        RETURNING id INTO v_matched_id;
        v_matched_ids := array_append(v_matched_ids, v_matched_id);
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND COALESCE(s.sent_quantity, 0) > 0
        AND NOT (oi.id = ANY(v_matched_ids))
    ) THEN
      RETURN jsonb_build_object('success', false,'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
        'detail', 'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path for already-sent quantity');
    END IF;
    DELETE FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND NOT (oi.id = ANY(v_matched_ids));
    IF v_old_table IS NOT NULL AND v_old_table IS DISTINCT FROM p_table_id AND NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = v_old_table AND status IN ('open', 'held') AND id <> p_order_id
    ) THEN
      UPDATE public.dining_tables SET status = 'vacant', updated_at = now() WHERE id = v_old_table;
    END IF;
    IF p_table_id IS NOT NULL THEN
      UPDATE public.dining_tables SET status = 'occupied', updated_at = now() WHERE id = p_table_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
;
RESET statement_timeout;
RESET lock_timeout;

