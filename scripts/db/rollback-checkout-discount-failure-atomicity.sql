-- Restore pre-repair definitions only after verifying no later checkout changes.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.process_sale(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_paid_amount numeric, p_payment_method text, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway'::text, p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req_id uuid;
  v_result jsonb;
  v_email text;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_price numeric;
  v_mod jsonb;
  v_line_discount numeric;
  v_server_subtotal numeric(14,2) := 0;
  v_sale_id uuid;
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_due numeric(14,2);
  v_header_discount numeric(14,2);
  v_effective_items jsonb := p_items;
  v_preview jsonb;
  v_remaining_unsent numeric(14,6) := 0;
  v_remaining_unsettled numeric(14,6) := 0;
  v_order_completed boolean := false;
  v_order_table uuid;
  v_order_owner uuid;
  v_order_paid numeric(14,2) := 0;
  v_order_total numeric(14,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.payment.take') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.payment.take');
  END IF;
  IF NOT public.user_may_access_branch(p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.branch_id = p_branch_id
      AND s.status = 'open'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_OPEN_SHIFT');
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT o.cashier_id
    INTO v_order_owner
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.branch_id = p_branch_id;

    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF v_order_owner IS DISTINCT FROM auth.uid() THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
    END IF;

    v_preview := public._build_order_settlement_preview(p_order_id);
    IF COALESCE((v_preview->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_preview;
    END IF;
    IF COALESCE((v_preview->>'pending_quantity')::numeric, 0) <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'NO_SENT_ITEMS_TO_SETTLE');
    END IF;
    v_effective_items := COALESCE(v_preview->'items', '[]'::jsonb);
  END IF;

  IF v_effective_items IS NULL OR jsonb_array_length(v_effective_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_effective_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id','')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_PRODUCT');
    END IF;
    IF v_qty <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY');
    END IF;

    SELECT sale_price INTO v_price
    FROM public.products
    WHERE id = v_product_id
      AND branch_id = p_branch_id
      AND is_active = true;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
    END IF;

    v_mod := public.resolve_product_modifiers(
      v_product_id,
      p_branch_id,
      COALESCE(v_item->'modifier_option_ids', '[]'::jsonb)
    );
    IF COALESCE((v_mod->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_mod;
    END IF;

    v_price := GREATEST(COALESCE(v_price,0) + COALESCE((v_mod->>'price_delta')::numeric,0), 0);
    v_line_discount := ROUND(LEAST(
      GREATEST(COALESCE((v_item->>'discount_amount')::numeric,0),0),
      v_qty * v_price
    ),2);
    IF v_line_discount > 0 AND NOT public.can_permission('pos.discount') THEN
      RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount','scope','line');
    END IF;
    v_server_subtotal := v_server_subtotal + ROUND(v_qty * v_price - v_line_discount, 2);
  END LOOP;

  v_server_subtotal := ROUND(v_server_subtotal, 2);
  v_header_discount := CASE WHEN p_order_id IS NOT NULL
    THEN LEAST(GREATEST(COALESCE((v_preview->>'discount_amount')::numeric, 0), 0), v_server_subtotal)
    ELSE LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_server_subtotal)
  END;

  SELECT t.tax_enabled, t.tax_rate
  INTO v_tax_enabled, v_tax_rate
  FROM public._effective_branch_tax(p_branch_id) t;

  v_due := ROUND(
    v_server_subtotal - v_header_discount +
    CASE WHEN COALESCE(v_tax_enabled,false)
      THEN ROUND((v_server_subtotal-v_header_discount)*COALESCE(v_tax_rate,0)/100,2)
      ELSE 0 END,
    2
  );

  IF p_order_id IS NOT NULL
     AND COALESCE(p_payment_method, 'cash') <> 'credit'
     AND ROUND(GREATEST(COALESCE(p_paid_amount,0),0),2) < v_due THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'FULL_PAYMENT_REQUIRED_FOR_SENT_ITEMS',
      'total_due', v_due,
      'paid_amount', ROUND(GREATEST(COALESCE(p_paid_amount,0),0),2)
    );
  END IF;

  IF v_header_discount > 0 AND NOT public.can_permission('pos.discount') THEN
    SELECT id INTO v_req_id
    FROM public.approval_requests
    WHERE requester_id = auth.uid()
      AND branch_id = p_branch_id
      AND action_type = 'discount'
      AND status = 'approved'
      AND expires_at > now()
      AND (entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_order_id)
      AND abs(COALESCE((payload->>'discount_amount')::numeric,-1) - v_header_discount) < 0.0001
    ORDER BY decided_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_req_id IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount');
    END IF;

    UPDATE public.approval_requests
    SET status='consumed', consumed_at=now()
    WHERE id=v_req_id;

    SELECT email INTO v_email FROM public.users WHERE id=auth.uid();
    INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
    VALUES(
      auth.uid(),v_email,'APPROVAL_CONSUMED','approval_request',v_req_id,
      jsonb_build_object('action_type','discount','discount_amount',v_header_discount,'order_id',p_order_id,'invoice_number',p_invoice_number),
      p_branch_id
    );
  END IF;

  IF p_order_id IS NOT NULL THEN
    v_result := public._prepare_kitchen_sale_settlement(
      p_order_id,
      p_branch_id,
      p_warehouse_id,
      v_effective_items
    );
    IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN v_result;
    END IF;

    SELECT table_id INTO v_order_table
    FROM public.orders
    WHERE id = p_order_id;
  END IF;

  -- Do not let _process_sale_core close the linked order. The outer function
  -- decides completion only after exact kitchen events are finalized.
  v_result := public._process_sale_core(
    p_invoice_number,
    p_branch_id,
    p_warehouse_id,
    p_customer_id,
    CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END,
    v_server_subtotal,
    v_header_discount,
    'amount',
    0,
    p_bonus_amount,
    0,
    p_paid_amount,
    p_payment_method,
    p_status,
    v_effective_items,
    p_shift_id,
    p_order_type,
    p_table_id,
    NULL,
    p_guest_count
  );

  IF COALESCE((v_result->>'success')::boolean,false) IS TRUE AND p_shift_id IS NOT NULL THEN
    v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
    INSERT INTO public.shift_operations(
      shift_id, operation_type, amount, payment_method,
      reference_type, reference_id, created_by
    )
    SELECT p_shift_id, 'sale', s.paid_amount, s.payment_method, 'sale', s.id, auth.uid()
    FROM public.sales s
    WHERE s.id = v_sale_id
      AND s.branch_id = p_branch_id
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_operations so
        WHERE so.reference_type = 'sale'
          AND so.reference_id = s.id
      );
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM set_config('app.kitchen_inventory_settlement','off',true);
    IF COALESCE((v_result->>'success')::boolean,false) IS TRUE THEN
      v_sale_id := NULLIF(v_result->>'sale_id','')::uuid;
      v_result := v_result || public._finalize_kitchen_sale_settlement(v_sale_id);

      SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity),0)
      INTO v_remaining_unsettled
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_id = p_order_id
        AND e.settled_sale_id IS NULL
        AND e.sent_quantity > e.voided_quantity;

      SELECT COALESCE(sum(GREATEST(oi.quantity - COALESCE(s.sent_quantity,0),0)),0)
      INTO v_remaining_unsent
      FROM public.order_items oi
      LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id;

      v_order_completed := v_remaining_unsettled <= 0.000001
                           AND v_remaining_unsent <= 0.000001;

      IF v_order_completed THEN
        UPDATE public.orders
        SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = p_order_id
          AND branch_id = p_branch_id
          AND status IN ('open','held');

        IF v_order_table IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.table_id = v_order_table
            AND o.status IN ('open','held')
            AND o.id <> p_order_id
        ) THEN
          UPDATE public.dining_tables
          SET status = 'vacant', updated_at = now()
          WHERE id = v_order_table;
        END IF;
      END IF;

      SELECT
        COALESCE(sum(s.paid_amount),0),
        COALESCE(sum(s.total),0)
      INTO v_order_paid, v_order_total
      FROM public.sales s
      WHERE s.id IN (
        SELECT DISTINCT e.settled_sale_id
        FROM public.order_kitchen_inventory_events e
        WHERE e.order_id = p_order_id
          AND e.settled_sale_id IS NOT NULL
      );

      UPDATE public.orders
      SET payment_status = CASE
            WHEN v_order_total > 0 AND v_order_paid >= v_order_total THEN
              CASE WHEN v_order_completed THEN 'paid' ELSE 'partial' END
            WHEN v_order_paid > 0 THEN 'partial'
            ELSE 'unpaid'
          END,
          payment_at = CASE WHEN v_order_paid > 0 THEN now() ELSE payment_at END,
          updated_at = now()
      WHERE id = p_order_id
        AND branch_id = p_branch_id;

      v_result := v_result || jsonb_build_object(
        'order_completed', v_order_completed,
        'remaining_unsent_quantity', v_remaining_unsent,
        'remaining_unsettled_quantity', v_remaining_unsettled
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$

CREATE OR REPLACE FUNCTION public.process_sale_split(p_invoice_number text, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_salesperson_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_type text, p_tax_amount numeric, p_bonus_amount numeric, p_total numeric, p_payments jsonb, p_status text, p_items jsonb, p_shift_id uuid DEFAULT NULL::uuid, p_order_type text DEFAULT 'takeaway'::text, p_table_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment jsonb;
  v_method text;
  v_amount numeric(14,2);
  v_requested_total numeric(14,2) := 0;
  v_method_count integer := 0;
  v_core jsonb;
  v_sale_id uuid;
  v_sale_total numeric(14,2);
  v_sale_entry uuid;
  v_cash_account uuid;
  v_bank_account uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_price numeric;
  v_mod jsonb;
  v_line_discount numeric;
  v_server_subtotal numeric(14,2) := 0;
  v_header_discount numeric(14,2);
  v_tax_enabled boolean;
  v_tax_rate numeric(14,2);
  v_due numeric(14,2);
  v_req_id uuid;
  v_email text;
  v_order_owner uuid;
BEGIN
  BEGIN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;
    IF NOT public.can_permission('pos.payment.take') THEN
      RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.payment.take');
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) THEN
      RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
    END IF;

    IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) < 2 THEN
      RETURN jsonb_build_object('success', false, 'error', 'SPLIT_REQUIRES_MULTIPLE_PAYMENTS');
    END IF;

    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      v_method := lower(trim(COALESCE(v_payment->>'payment_method', '')));
      v_amount := round(COALESCE((v_payment->>'amount')::numeric, 0), 2);
      IF v_method NOT IN ('cash', 'card', 'transfer') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SPLIT_PAYMENT_METHOD', 'payment_method', v_method);
      END IF;
      IF v_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SPLIT_PAYMENT_AMOUNT', 'payment_method', v_method);
      END IF;
      v_requested_total := v_requested_total + v_amount;
    END LOOP;

    SELECT count(DISTINCT lower(trim(value->>'payment_method')))
      INTO v_method_count
    FROM jsonb_array_elements(p_payments);
    IF v_method_count < 2 THEN
      RETURN jsonb_build_object('success', false, 'error', 'SPLIT_REQUIRES_MULTIPLE_METHODS');
    END IF;

    -- Match normal checkout discount authorization before any financial write.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := NULLIF(v_item->>'product_id','')::uuid;
      v_qty := COALESCE((v_item->>'quantity')::numeric,0);
      IF v_product_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_PRODUCT'); END IF;
      IF v_qty <= 0 THEN RETURN jsonb_build_object('success',false,'error','INVALID_QUANTITY'); END IF;
      SELECT sale_price INTO v_price FROM public.products WHERE id=v_product_id AND branch_id=p_branch_id AND is_active=true;
      IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','PRODUCT_NOT_IN_BRANCH','product_id',v_product_id); END IF;
      v_mod := public.resolve_product_modifiers(v_product_id,p_branch_id,COALESCE(v_item->'modifier_option_ids','[]'::jsonb));
      IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_mod; END IF;
      v_price := GREATEST(COALESCE(v_price,0)+COALESCE((v_mod->>'price_delta')::numeric,0),0);
      v_line_discount := ROUND(LEAST(GREATEST(COALESCE((v_item->>'discount_amount')::numeric,0),0),v_qty*v_price),2);
      IF v_line_discount > 0 AND NOT public.can_permission('pos.discount') THEN
        RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount','scope','line');
      END IF;
      v_server_subtotal := v_server_subtotal + ROUND(v_qty*v_price-v_line_discount,2);
    END LOOP;
    v_server_subtotal := ROUND(v_server_subtotal,2);
    v_header_discount := LEAST(GREATEST(COALESCE(p_discount_amount,0),0),v_server_subtotal);
    IF COALESCE(p_discount_amount,0)>0 AND NOT public.can_permission('pos.discount') THEN
      SELECT id INTO v_req_id FROM public.approval_requests
      WHERE requester_id=auth.uid() AND branch_id=p_branch_id AND action_type='discount'
        AND status='approved' AND expires_at>now()
        AND (entity_id IS NULL OR entity_id IS NOT DISTINCT FROM p_order_id)
        AND COALESCE(payload->>'discount_type','amount')=COALESCE(p_discount_type,'amount')
        AND abs(COALESCE((payload->>'discount_amount')::numeric,-1)-p_discount_amount)<0.0001
        AND abs(COALESCE((payload->>'subtotal')::numeric,-1)-v_server_subtotal)<0.0001
      ORDER BY decided_at DESC NULLS LAST,created_at DESC LIMIT 1 FOR UPDATE;
      IF v_req_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','MANAGER_APPROVAL_REQUIRED','action','discount'); END IF;
      UPDATE public.approval_requests SET status='consumed',consumed_at=now() WHERE id=v_req_id;
      SELECT email INTO v_email FROM public.users WHERE id=auth.uid();
      INSERT INTO public.audit_log(user_id,user_email,action,entity,entity_id,details,branch_id)
      VALUES(auth.uid(),v_email,'APPROVAL_CONSUMED','approval_request',v_req_id,
        jsonb_build_object('action_type','discount','discount_amount',p_discount_amount,'discount_type',p_discount_type,
          'server_subtotal',v_server_subtotal,'order_id',p_order_id),p_branch_id);
    END IF;
    SELECT t.tax_enabled,t.tax_rate INTO v_tax_enabled,v_tax_rate FROM public._effective_branch_tax(p_branch_id) t;
    v_due := ROUND(v_server_subtotal-v_header_discount+CASE WHEN COALESCE(v_tax_enabled,false) THEN ROUND((v_server_subtotal-v_header_discount)*COALESCE(v_tax_rate,0)/100,2) ELSE 0 END,2);
    IF ROUND(v_requested_total,2) <> v_due THEN
      RETURN jsonb_build_object('success',false,'error','SPLIT_PAYMENT_TOTAL_MISMATCH','total_due',v_due,'paid_amount',ROUND(v_requested_total,2));
    END IF;

    -- The existing sale core remains the single stock/write boundary.
    -- Use a temporary cash collection, then replace only the collection-side accounting below.
    IF p_order_id IS NOT NULL THEN
      SELECT o.cashier_id INTO v_order_owner
      FROM public.orders o
      WHERE o.id=p_order_id AND o.branch_id=p_branch_id AND o.status IN ('open','held');
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
      END IF;
      IF v_order_owner IS DISTINCT FROM auth.uid() THEN
        PERFORM set_config('app.pos_action_authorized','1',true);
        PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
        PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
        PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
      END IF;
      v_core := public._prepare_kitchen_sale_settlement(p_order_id,p_branch_id,p_warehouse_id,p_items);
      IF COALESCE((v_core->>'success')::boolean,false) IS NOT TRUE THEN RETURN v_core; END IF;
    END IF;

    v_core := public._process_sale_core(
      p_invoice_number,
      p_branch_id,
      p_warehouse_id,
      p_customer_id,
      CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END,
      p_subtotal,
      p_discount_amount,
      p_discount_type,
      p_tax_amount,
      p_bonus_amount,
      p_total,
      v_requested_total,
      'cash',
      p_status,
      p_items,
      p_shift_id,
      p_order_type,
      p_table_id,
      p_order_id,
      p_guest_count
    );

    IF p_order_id IS NOT NULL THEN
      PERFORM set_config('app.kitchen_inventory_settlement','off',true);
      IF COALESCE((v_core->>'success')::boolean,false) IS TRUE THEN
        v_core := v_core || public._finalize_kitchen_sale_settlement(NULLIF(v_core->>'sale_id','')::uuid);
      END IF;
    END IF;

    IF COALESCE((v_core->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_core;
    END IF;

    v_sale_id := (v_core->>'sale_id')::uuid;
    SELECT total INTO v_sale_total FROM public.sales WHERE id = v_sale_id FOR UPDATE;

    IF round(COALESCE(v_sale_total, 0), 2) <> round(v_requested_total, 2) THEN
      RAISE EXCEPTION 'SPLIT_PAYMENT_TOTAL_MISMATCH: expected %, got %', v_sale_total, v_requested_total;
    END IF;

    INSERT INTO public.sale_payments(sale_id, branch_id, payment_method, amount, created_by)
    SELECT
      v_sale_id,
      p_branch_id,
      lower(trim(value->>'payment_method')),
      round((value->>'amount')::numeric, 2),
      auth.uid()
    FROM jsonb_array_elements(p_payments);

    UPDATE public.sales
    SET payment_method = 'split', paid_amount = v_sale_total
    WHERE id = v_sale_id;

    -- SPLIT_ORDER_PAYMENT_STATUS_SYNC
    -- Mirror the normal process_sale linked-order reconciliation after
    -- the split sale has its final paid_amount and Kitchen events are settled.
    IF p_order_id IS NOT NULL THEN
      UPDATE public.orders o
      SET payment_status = CASE
            WHEN x.total > 0 AND x.paid >= x.total THEN
              CASE WHEN o.status = 'completed' THEN 'paid' ELSE 'partial' END
            WHEN x.paid > 0 THEN 'partial'
            ELSE 'unpaid'
          END,
          payment_at = CASE WHEN x.paid > 0 THEN now() ELSE o.payment_at END,
          updated_at = now()
      FROM (
        SELECT
          COALESCE(sum(s.paid_amount), 0) AS paid,
          COALESCE(sum(s.total), 0) AS total
        FROM public.sales s
        WHERE s.id IN (
          SELECT DISTINCT e.settled_sale_id
          FROM public.order_kitchen_inventory_events e
          WHERE e.order_id = p_order_id
            AND e.settled_sale_id IS NOT NULL
        )
      ) x
      WHERE o.id = p_order_id
        AND o.branch_id = p_branch_id;
    END IF;

    -- Replace the one temporary shift collection with one row per tender.
    IF p_shift_id IS NOT NULL THEN
      DELETE FROM public.shift_operations
      WHERE shift_id = p_shift_id
        AND operation_type = 'sale'
        AND reference_type = 'sale'
        AND reference_id = v_sale_id;

      INSERT INTO public.shift_operations(
        shift_id, operation_type, amount, payment_method, reference_type, reference_id, created_by
      )
      SELECT
        p_shift_id,
        'sale',
        round((value->>'amount')::numeric, 2),
        lower(trim(value->>'payment_method')),
        'sale',
        v_sale_id,
        auth.uid()
      FROM jsonb_array_elements(p_payments);
    END IF;

    -- Rewrite only collection debit lines. Revenue/VAT/discount/COGS remain exactly as core posted them.
    SELECT id INTO v_sale_entry
    FROM public.journal_entries
    WHERE branch_id = p_branch_id
      AND reference_type = 'sale'
      AND reference_id = v_sale_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_sale_entry IS NULL THEN
      RAISE EXCEPTION 'SPLIT_SALE_JOURNAL_NOT_FOUND';
    END IF;

    v_cash_account := public.resolve_account_key(p_branch_id, 'cash');
    v_bank_account := public.resolve_account_key(p_branch_id, 'bank');

    DELETE FROM public.journal_entry_lines
    WHERE journal_entry_id = v_sale_entry
      AND account_id IN (v_cash_account, v_bank_account)
      AND debit > 0;

    INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, note)
    SELECT
      v_sale_entry,
      CASE WHEN lower(trim(value->>'payment_method')) = 'cash' THEN v_cash_account ELSE v_bank_account END,
      round((value->>'amount')::numeric, 2),
      0,
      p_invoice_number || ' · ' || lower(trim(value->>'payment_method'))
    FROM jsonb_array_elements(p_payments);

    RETURN v_core || jsonb_build_object(
      'split', true,
      'payment_count', jsonb_array_length(p_payments),
      'paid_amount', v_sale_total
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$

COMMIT;

