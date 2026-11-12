CREATE OR REPLACE FUNCTION public.enforce_pos_permission_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_print_only_mutation boolean := false;
  v_item_transfer_context boolean := false;
  v_sent_item_void_context boolean := false;
  v_pos_action_context boolean := false;
BEGIN
  IF v_is_service_role OR v_uid IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='sales' THEN
    IF TG_OP='INSERT' AND NOT public.can_permission('pos.payment.take') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_kitchen_sends' THEN
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(
        CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END,
        CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
      );
    IF NOT public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='orders' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.can_permission('pos.order.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create'; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.cancel_order') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order'; END IF;
      RETURN OLD;
    END IF;

    v_print_only_mutation :=
      (NEW.print_status IS DISTINCT FROM OLD.print_status OR NEW.printed_at IS DISTINCT FROM OLD.printed_at)
      AND (to_jsonb(NEW)-ARRAY['print_status','printed_at','updated_at']::text[])
        = (to_jsonb(OLD)-ARRAY['print_status','printed_at','updated_at']::text[]);
    IF v_print_only_mutation THEN
      IF NOT public.can_permission('pos.receipt.print') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.receipt.print'; END IF;
      RETURN NEW;
    END IF;

    IF NEW.kitchen_status IS DISTINCT FROM OLD.kitchen_status
       AND (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[])
         = (to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[]) THEN
      IF OLD.kitchen_status='pending'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_id=OLD.id) THEN
        RETURN NEW;
      END IF;

      -- A served order may receive later additions. This is still a
      -- send-to-kitchen transition, not broad KDS management. Allow it only
      -- when an authoritative served baseline exists and cumulative sent
      -- quantity now exceeds that baseline for at least one line.
      IF OLD.kitchen_status='served'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(
           SELECT 1 FROM public.order_kitchen_served_quantities baseline
           WHERE baseline.order_id = OLD.id
         )
         AND EXISTS(
           SELECT 1
           FROM public.order_kitchen_sends s
           LEFT JOIN public.order_kitchen_served_quantities ksb
             ON ksb.order_id = OLD.id
            AND ksb.order_item_id = s.order_item_id
           WHERE s.order_id = OLD.id
             AND COALESCE(s.sent_quantity,0) > COALESCE(ksb.served_quantity,0)
         ) THEN
        RETURN NEW;
      END IF;
      IF NOT public.can_permission('pos.kds_update') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update'; END IF;
      RETURN NEW;
    END IF;

    IF NEW.station IS DISTINCT FROM OLD.station
       AND (to_jsonb(NEW)-ARRAY['station','updated_at']::text[])=(to_jsonb(OLD)-ARRAY['station','updated_at']::text[]) THEN
      IF NOT public.can_permission('pos.kds_update') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update'; END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status='cancelled' AND NOT public.can_permission('pos.cancel_order') THEN
        -- Empty-source cancellation created by the exact item-transfer RPC is structural,
        -- not a user void/cancel action.
        IF NOT (
          COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
          AND public.can_permission('pos.order.transfer')
        )
        -- A signed sent-item Void may structurally close its own now-empty order.
        -- This does not grant the caller generic pos.cancel_order authority.
        AND NOT public._sent_item_void_context_matches(OLD.id,NULL) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
        END IF;
      ELSIF NEW.status='completed' THEN
        IF NOT public.can_permission('pos.payment.take') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take'; END IF;
        v_pos_action_context :=
          public._pos_action_context_matches(OLD.id,'pos.payment.take');
        IF NOT public.can_permission('pos.order.edit')
           AND NOT v_pos_action_context
           AND (to_jsonb(NEW)-ARRAY['status','payment_status','payment_at','updated_at']::text[])
             IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','payment_status','payment_at','updated_at']::text[]) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
        END IF;
      ELSIF NEW.status IN ('open','held') AND NOT public.can_permission('pos.hold') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.hold';
      END IF;
    END IF;

    IF NEW.table_id IS DISTINCT FROM OLD.table_id
       AND OLD.table_id IS NOT NULL
       AND NOT public.can_permission('pos.order.transfer') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.transfer';
    END IF;

    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    v_pos_action_context :=
      public._pos_action_context_matches(OLD.id,'pos.payment.take')
      OR public._pos_action_context_matches(OLD.id,'pos.send_kitchen')
      OR public._pos_action_context_matches(OLD.id,'pos.cancel_order');

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context
       AND NOT v_pos_action_context THEN
      -- Recalculation/status bookkeeping inside the exact item transfer is permitted
      -- by transfer permission without broad edit permission.
      IF NOT (
        (
          COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
          OR COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=OLD.id::text
        )
        AND public.can_permission('pos.order.transfer')
      ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_items' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.can_permission('pos.order.create') AND NOT public.can_permission('pos.order.edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
      END IF;
      RETURN NEW;
    END IF;
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.void')
         AND NOT v_sent_item_void_context THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.void';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_item_ids',true),'') LIKE '%' || OLD.id::text || '%'
        AND public.can_permission('pos.order.transfer');

      IF NOT v_item_transfer_context AND NOT public.can_permission('pos.order.split') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.split';
      END IF;
    ELSIF NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;

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
  ),
  candidates AS (
    SELECT unit_cost, created_at, tie, 1 AS priority FROM last_fifo_issue
    UNION ALL
    SELECT unit_cost, created_at, tie, 2 AS priority FROM last_receipt_ledger
    UNION ALL
    SELECT unit_cost, created_at, tie, 3 AS priority FROM last_real_batch
    UNION ALL
    SELECT unit_cost, created_at, tie, 4 AS priority FROM default_price
  )
  SELECT COALESCE((
    SELECT c.unit_cost
    FROM candidates c
    WHERE COALESCE(c.unit_cost, 0) > 0
    ORDER BY c.priority, c.created_at DESC NULLS LAST, c.tie DESC
    LIMIT 1
  ), 0)::numeric;
$function$
;
-- Captured original definitions; apply transactionally after checking candidate
-- hashes in the work log. Also rehearsed in disposable CI under SAVEPOINT.
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
    CREATE TEMP TABLE IF NOT EXISTS _upd_matched (order_item_id uuid) ON COMMIT DROP;
    TRUNCATE _upd_matched;
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
          AND NOT EXISTS (SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id);
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
          AND NOT EXISTS (SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id)
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
        INSERT INTO _upd_matched (order_item_id) VALUES (v_matched_id);
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
        INSERT INTO _upd_matched (order_item_id) VALUES (v_matched_id);
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND COALESCE(s.sent_quantity, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id)
    ) THEN
      RETURN jsonb_build_object('success', false,'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
        'detail', 'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path for already-sent quantity');
    END IF;
    DELETE FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND NOT EXISTS (SELECT 1 FROM _upd_matched m WHERE m.order_item_id = oi.id);
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
