-- Permission-first hardening for SECURITY DEFINER POS order mutation RPCs.
-- Also prevents update_order from deleting/reducing/reconfiguring a kitchen-sent
-- line outside the controlled audited void path.

CREATE OR REPLACE FUNCTION public.create_order(
  p_branch_id uuid,
  p_order_type text DEFAULT 'dine_in'::text,
  p_table_id uuid DEFAULT NULL::uuid,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_guest_count integer DEFAULT NULL::integer,
  p_notes text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_subtotal numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'amount'::text,
  p_tax_amount numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_cashier_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_id uuid;
  v_number jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_effective_cashier uuid;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
      END IF;
      IF NOT public.can_permission('pos.order.create') THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.create');
      END IF;
      IF NOT public.user_may_access_branch(p_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      v_effective_cashier := v_uid;
    ELSE
      v_effective_cashier := p_cashier_id;
    END IF;

    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables
      WHERE id = p_table_id AND branch_id = p_branch_id AND is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    IF p_table_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE table_id = p_table_id AND status IN ('open', 'held')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_BUSY',
        'detail', 'This table already has an open order.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE id = v_product_id AND branch_id = p_branch_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
      END IF;
    END LOOP;

    v_number := public.next_document_number('order');
    IF NOT (v_number->>'success')::boolean THEN
      RETURN jsonb_build_object('success', false, 'error', 'NUMBERING_FAILED', 'detail', v_number->>'error');
    END IF;

    INSERT INTO public.orders (
      order_number, branch_id, order_type, status, table_id, customer_id,
      cashier_id, guest_count, notes, subtotal, discount_amount, discount_type,
      tax_amount, total
    ) VALUES (
      v_number->>'number', p_branch_id, COALESCE(p_order_type, 'dine_in'), 'open', p_table_id,
      p_customer_id, v_effective_cashier, p_guest_count, p_notes,
      COALESCE(p_subtotal, 0), COALESCE(p_discount_amount, 0), COALESCE(p_discount_type, 'amount'),
      COALESCE(p_tax_amount, 0), COALESCE(p_total, 0)
    ) RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      INSERT INTO public.order_items (
        order_id, product_id, unit_name, quantity, unit_price,
        discount_amount, bonus_quantity, total, modifier_option_ids, notes
      ) VALUES (
        v_order_id,
        (v_item->>'product_id')::uuid,
        COALESCE(v_item->>'unit_name', 'piece'),
        COALESCE((v_item->>'quantity')::numeric, 1),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'discount_amount')::numeric, 0),
        COALESCE((v_item->>'bonus_quantity')::numeric, 0),
        COALESCE((v_item->>'total')::numeric, 0),
        ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))),
        NULLIF(v_item->>'notes', '')
      );
    END LOOP;

    IF p_table_id IS NOT NULL THEN
      UPDATE public.dining_tables
      SET status = 'occupied', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_number->>'number');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_order(
  p_order_id uuid,
  p_order_type text DEFAULT 'dine_in'::text,
  p_table_id uuid DEFAULT NULL::uuid,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_guest_count integer DEFAULT NULL::integer,
  p_notes text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_subtotal numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT 'amount'::text,
  p_tax_amount numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_status text DEFAULT 'held'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_old_table uuid;
  v_old_status text;
  v_owner_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_matched_id uuid;
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
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
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

    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables
      WHERE id = p_table_id AND branch_id = v_branch_id AND is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    IF p_table_id IS DISTINCT FROM v_old_table
       AND p_table_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.orders
         WHERE table_id = p_table_id
           AND status IN ('open', 'held')
           AND id <> p_order_id
       ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_BUSY');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE id = v_product_id AND branch_id = v_branch_id
      ) THEN
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

    CREATE TEMP TABLE IF NOT EXISTS pg_temp._upd_matched (order_item_id uuid PRIMARY KEY) ON COMMIT DROP;
    TRUNCATE pg_temp._upd_matched;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
      v_matched_id := NULL;

      SELECT oi.id INTO v_matched_id
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.product_id = v_product_id
        AND oi.unit_name = COALESCE(v_item->>'unit_name', 'piece')
        AND oi.modifier_option_ids = ARRAY(
          SELECT NULLIF(value, '')::uuid
          FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))
        )
        AND oi.discount_amount = COALESCE((v_item->>'discount_amount')::numeric, oi.discount_amount)
        AND oi.bonus_quantity = COALESCE((v_item->>'bonus_quantity')::numeric, oi.bonus_quantity)
        AND NOT EXISTS (
          SELECT 1 FROM pg_temp._upd_matched m WHERE m.order_item_id = oi.id
        )
      LIMIT 1;

      IF v_matched_id IS NOT NULL THEN
        SELECT COALESCE(s.sent_quantity, 0)
        INTO v_sent_quantity
        FROM public.order_items oi
        LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
        WHERE oi.id = v_matched_id;

        IF v_quantity + 0.000001 < COALESCE(v_sent_quantity, 0) THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID',
            'order_item_id', v_matched_id,
            'sent_quantity', v_sent_quantity
          );
        END IF;

        UPDATE public.order_items SET
          quantity = v_quantity,
          total = COALESCE((v_item->>'total')::numeric, 0),
          notes = NULLIF(v_item->>'notes', '')
        WHERE id = v_matched_id;

        INSERT INTO pg_temp._upd_matched(order_item_id) VALUES (v_matched_id);
      ELSE
        INSERT INTO public.order_items (
          order_id, product_id, unit_name, quantity, unit_price,
          discount_amount, bonus_quantity, total, modifier_option_ids, notes
        ) VALUES (
          p_order_id,
          v_product_id,
          COALESCE(v_item->>'unit_name', 'piece'),
          v_quantity,
          COALESCE((v_item->>'unit_price')::numeric, 0),
          COALESCE((v_item->>'discount_amount')::numeric, 0),
          COALESCE((v_item->>'bonus_quantity')::numeric, 0),
          COALESCE((v_item->>'total')::numeric, 0),
          ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))),
          NULLIF(v_item->>'notes', '')
        ) RETURNING id INTO v_matched_id;

        INSERT INTO pg_temp._upd_matched(order_item_id) VALUES (v_matched_id);
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND COALESCE(s.sent_quantity, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM pg_temp._upd_matched m WHERE m.order_item_id = oi.id
        )
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'SENT_ITEM_CHANGE_REQUIRES_VOID');
    END IF;

    DELETE FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND NOT EXISTS (
        SELECT 1 FROM pg_temp._upd_matched m WHERE m.order_item_id = oi.id
      );

    IF v_old_table IS NOT NULL
       AND v_old_table IS DISTINCT FROM p_table_id
       AND NOT EXISTS (
         SELECT 1 FROM public.orders
         WHERE table_id = v_old_table
           AND status IN ('open', 'held')
           AND id <> p_order_id
       ) THEN
      UPDATE public.dining_tables
      SET status = 'vacant', updated_at = now()
      WHERE id = v_old_table;
    END IF;

    IF p_table_id IS NOT NULL THEN
      UPDATE public.dining_tables
      SET status = 'occupied', updated_at = now()
      WHERE id = p_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$;
