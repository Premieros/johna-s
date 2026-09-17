-- Server-authoritative sent-only POS settlement.
-- Physical inventory deduction remains owned by send_to_kitchen. Payment consumes
-- only unvoided, unsettled kitchen inventory events. Unsent additions remain open.

CREATE OR REPLACE FUNCTION public._build_order_settlement_preview(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_previous_discount numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_tax_enabled boolean := false;
  v_tax_rate numeric(14,2) := 0;
  v_pending numeric(14,6) := 0;
  v_event_pending numeric(14,6) := 0;
  v_unsent numeric(14,6) := 0;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.status NOT IN ('open', 'held') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
  END IF;

  SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity), 0)
  INTO v_event_pending
  FROM public.order_kitchen_inventory_events e
  WHERE e.order_id = p_order_id
    AND e.settled_sale_id IS NULL
    AND e.sent_quantity > e.voided_quantity;

  WITH pending AS (
    SELECT
      oi.id AS order_item_id,
      oi.product_id,
      COALESCE(oi.unit_name, 'piece') AS unit_name,
      oi.quantity AS order_quantity,
      COALESCE(oi.discount_amount, 0) AS order_line_discount,
      COALESCE(oi.modifier_option_ids, '{}'::uuid[]) AS modifier_option_ids,
      oi.notes,
      sum(e.sent_quantity - e.voided_quantity)::numeric(14,6) AS quantity
    FROM public.order_items oi
    JOIN public.order_kitchen_inventory_events e
      ON e.order_item_id = oi.id
     AND e.order_id = oi.order_id
     AND e.settled_sale_id IS NULL
     AND e.sent_quantity > e.voided_quantity
    WHERE oi.order_id = p_order_id
    GROUP BY oi.id, oi.product_id, oi.unit_name, oi.quantity,
             oi.discount_amount, oi.modifier_option_ids, oi.notes
  ), priced AS (
    SELECT
      pnd.*,
      GREATEST(
        COALESCE(p.sale_price, 0) + COALESCE((r.mod->>'price_delta')::numeric, 0),
        0
      )::numeric(14,2) AS unit_price,
      r.mod
    FROM pending pnd
    JOIN public.products p
      ON p.id = pnd.product_id
     AND p.branch_id = v_order.branch_id
     AND p.is_active = true
    CROSS JOIN LATERAL (
      SELECT public.resolve_product_modifiers(
        pnd.product_id,
        v_order.branch_id,
        to_jsonb(pnd.modifier_option_ids)
      ) AS mod
    ) r
    WHERE COALESCE((r.mod->>'success')::boolean, false) IS TRUE
  ), shaped AS (
    SELECT
      jsonb_build_object(
        'product_id', product_id,
        'unit_name', unit_name,
        'quantity', quantity,
        'unit_price', unit_price,
        'discount_amount', ROUND(LEAST(
          GREATEST(CASE WHEN order_quantity > 0
            THEN order_line_discount * quantity / order_quantity ELSE 0 END, 0),
          quantity * unit_price
        ), 2),
        'bonus_quantity', 0,
        'total', ROUND(quantity * unit_price - LEAST(
          GREATEST(CASE WHEN order_quantity > 0
            THEN order_line_discount * quantity / order_quantity ELSE 0 END, 0),
          quantity * unit_price
        ), 2),
        'modifier_option_ids', to_jsonb(modifier_option_ids),
        'notes', notes,
        'order_item_id', order_item_id
      ) AS item,
      ROUND(quantity * unit_price - LEAST(
        GREATEST(CASE WHEN order_quantity > 0
          THEN order_line_discount * quantity / order_quantity ELSE 0 END, 0),
        quantity * unit_price
      ), 2) AS line_subtotal,
      quantity
    FROM priced
  )
  SELECT
    COALESCE(jsonb_agg(item ORDER BY item->>'order_item_id'), '[]'::jsonb),
    COALESCE(ROUND(sum(line_subtotal), 2), 0),
    COALESCE(sum(quantity), 0)
  INTO v_items, v_subtotal, v_pending
  FROM shaped;

  -- Fail closed if a pending kitchen event cannot be mapped to a valid sellable
  -- order line/modifier configuration. Never silently omit payable quantities.
  IF abs(v_pending - v_event_pending) > 0.000001 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_ITEM_CONFIGURATION_INVALID');
  END IF;

  SELECT COALESCE(sum(s.discount_amount), 0)
  INTO v_previous_discount
  FROM public.sales s
  WHERE s.id IN (
    SELECT DISTINCT e.settled_sale_id
    FROM public.order_kitchen_inventory_events e
    WHERE e.order_id = p_order_id
      AND e.settled_sale_id IS NOT NULL
  );

  v_discount := ROUND(LEAST(
    GREATEST(COALESCE(v_order.discount_amount, 0) - v_previous_discount, 0),
    v_subtotal
  ), 2);

  SELECT t.tax_enabled, t.tax_rate
  INTO v_tax_enabled, v_tax_rate
  FROM public._effective_branch_tax(v_order.branch_id) t;

  v_tax := CASE WHEN COALESCE(v_tax_enabled, false)
    THEN ROUND((v_subtotal - v_discount) * COALESCE(v_tax_rate, 0) / 100, 2)
    ELSE 0 END;
  v_total := ROUND(v_subtotal - v_discount + v_tax, 2);

  SELECT COALESCE(sum(GREATEST(oi.quantity - COALESCE(s.sent_quantity, 0), 0)), 0)
  INTO v_unsent
  FROM public.order_items oi
  LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
  WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'branch_id', v_order.branch_id,
    'warehouse_id', v_order.inventory_warehouse_id,
    'order_status', v_order.status,
    'items', v_items,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'discount_type', 'amount',
    'tax_amount', v_tax,
    'total', v_total,
    'pending_quantity', v_pending,
    'unsent_quantity', v_unsent,
    'has_payable_items', v_pending > 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._build_order_settlement_preview(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_order_settlement_preview(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.payment.take')
     AND NOT public.can_permission('pos.receipt.print') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_order.cashier_id IS DISTINCT FROM v_uid
     AND NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
  END IF;

  RETURN public._build_order_settlement_preview(p_order_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_order_settlement_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_settlement_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._prepare_kitchen_sale_settlement(
  p_order_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_preview jsonb;
  v_preview_shape jsonb;
  v_payload_shape jsonb;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.branch_id IS DISTINCT FROM p_branch_id
     OR NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_order.status NOT IN ('open', 'held') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
  END IF;
  IF p_warehouse_id IS NULL
     OR v_order.inventory_warehouse_id IS DISTINCT FROM p_warehouse_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'KITCHEN_WAREHOUSE_MISMATCH',
      'expected_warehouse_id', v_order.inventory_warehouse_id
    );
  END IF;

  v_preview := public._build_order_settlement_preview(p_order_id);
  IF COALESCE((v_preview->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_preview;
  END IF;
  IF COALESCE((v_preview->>'pending_quantity')::numeric, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_SENT_ITEMS_TO_SETTLE');
  END IF;

  SELECT COALESCE(jsonb_agg(x.shape ORDER BY x.shape::text), '[]'::jsonb)
  INTO v_preview_shape
  FROM (
    SELECT jsonb_build_object(
      'product_id', NULLIF(item->>'product_id','')::uuid,
      'unit_name', COALESCE(NULLIF(item->>'unit_name',''), 'piece'),
      'quantity', COALESCE((item->>'quantity')::numeric, 0),
      'modifier_option_ids', COALESCE(item->'modifier_option_ids', '[]'::jsonb)
    ) AS shape
    FROM jsonb_array_elements(COALESCE(v_preview->'items', '[]'::jsonb)) j(item)
  ) x;

  BEGIN
    SELECT COALESCE(jsonb_agg(x.shape ORDER BY x.shape::text), '[]'::jsonb)
    INTO v_payload_shape
    FROM (
      SELECT jsonb_build_object(
        'product_id', NULLIF(item->>'product_id','')::uuid,
        'unit_name', COALESCE(NULLIF(item->>'unit_name',''), 'piece'),
        'quantity', COALESCE((item->>'quantity')::numeric, 0),
        'modifier_option_ids', to_jsonb(ARRAY(
          SELECT j2.id::uuid
          FROM jsonb_array_elements_text(COALESCE(item->'modifier_option_ids','[]'::jsonb)) j2(id)
          ORDER BY j2.id::uuid
        ))
      ) AS shape
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) j(item)
    ) x;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_ITEMS_MISMATCH', 'detail', SQLERRM);
  END;

  IF v_preview_shape IS DISTINCT FROM v_payload_shape THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_ITEMS_MISMATCH');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.kitchen_settlement_queue (
    seq bigint GENERATED ALWAYS AS IDENTITY,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit_name text NOT NULL,
    quantity numeric(14,6) NOT NULL,
    modifier_option_ids uuid[] NOT NULL,
    event_ids uuid[] NOT NULL,
    consumed boolean NOT NULL DEFAULT false,
    PRIMARY KEY(seq)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.kitchen_settlement_queue RESTART IDENTITY;

  INSERT INTO pg_temp.kitchen_settlement_queue(
    order_id, order_item_id, product_id, unit_name, quantity,
    modifier_option_ids, event_ids
  )
  SELECT
    oi.order_id,
    oi.id,
    oi.product_id,
    COALESCE(oi.unit_name, 'piece'),
    sum(e.sent_quantity - e.voided_quantity)::numeric(14,6),
    COALESCE(oi.modifier_option_ids, '{}'::uuid[]),
    array_agg(e.id ORDER BY e.created_at, e.id)
  FROM public.order_items oi
  JOIN public.order_kitchen_inventory_events e
    ON e.order_item_id = oi.id
   AND e.order_id = oi.order_id
   AND e.settled_sale_id IS NULL
   AND e.sent_quantity > e.voided_quantity
  WHERE oi.order_id = p_order_id
  GROUP BY oi.order_id, oi.id, oi.product_id, oi.unit_name, oi.modifier_option_ids
  ORDER BY min(e.created_at), oi.id;

  PERFORM set_config('app.kitchen_inventory_settlement', 'on', true);
  PERFORM set_config('app.kitchen_inventory_order_id', p_order_id::text, true);
  RETURN v_preview;
END;
$function$;

CREATE OR REPLACE FUNCTION public._consume_kitchen_sale_settlement(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_sale_id uuid,
  p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item jsonb;
  v_queue record;
  v_event_qty numeric(14,6);
  v_units jsonb := '[]'::jsonb;
  v_raws jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_total_cost numeric(18,6) := 0;
BEGIN
  IF to_regclass('pg_temp.kitchen_settlement_queue') IS NULL
     OR p_items IS NULL OR jsonb_array_length(p_items) <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'KITCHEN_SETTLEMENT_CONTEXT_MISSING');
  END IF;

  v_item := p_items->0;
  SELECT q.* INTO v_queue
  FROM pg_temp.kitchen_settlement_queue q
  WHERE NOT q.consumed
    AND q.product_id = NULLIF(v_item->>'product_id','')::uuid
    AND q.unit_name = COALESCE(NULLIF(v_item->>'unit_name',''), 'piece')
    AND abs(q.quantity - COALESCE((v_item->>'quantity')::numeric, 0)) < 0.000001
    AND ARRAY(SELECT u.id FROM unnest(q.modifier_option_ids) u(id) ORDER BY u.id)
        = ARRAY(
          SELECT j.id::uuid
          FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids','[]'::jsonb)) j(id)
          ORDER BY j.id::uuid
        )
  ORDER BY q.seq
  LIMIT 1
  FOR UPDATE;

  IF v_queue.order_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_ITEMS_MISMATCH');
  END IF;

  SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity), 0)
  INTO v_event_qty
  FROM public.order_kitchen_inventory_events e
  WHERE e.id = ANY(v_queue.event_ids)
    AND e.settled_sale_id IS NULL
    AND e.sent_quantity > e.voided_quantity;

  IF abs(v_event_qty - v_queue.quantity) > 0.000001 THEN
    RETURN jsonb_build_object('success', false, 'error', 'KITCHEN_INVENTORY_EVENT_MISMATCH');
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'unit_id', z.target_id, 'quantity', z.quantity
    ) ORDER BY z.target_id) FILTER (WHERE z.target_type='inventory_unit'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'raw_material_id', z.target_id, 'quantity', z.quantity, 'total_cost', z.total_cost
    ) ORDER BY z.target_id) FILTER (WHERE z.target_type='raw_material'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', z.target_id, 'quantity', z.quantity, 'total_cost', z.total_cost
    ) ORDER BY z.target_id) FILTER (WHERE z.target_type='product'), '[]'::jsonb),
    COALESCE(sum(z.total_cost), 0)
  INTO v_units, v_raws, v_products, v_total_cost
  FROM (
    SELECT
      ef.target_type,
      ef.target_id,
      sum(ef.quantity * (ev.sent_quantity - ev.voided_quantity) / ev.sent_quantity) AS quantity,
      sum(ef.total_cost * (ev.sent_quantity - ev.voided_quantity) / ev.sent_quantity) AS total_cost
    FROM public.order_kitchen_inventory_events ev
    JOIN public.order_kitchen_inventory_effects ef ON ef.event_id = ev.id
    WHERE ev.id = ANY(v_queue.event_ids)
      AND ev.settled_sale_id IS NULL
      AND ev.sent_quantity > ev.voided_quantity
    GROUP BY ef.target_type, ef.target_id
  ) z;

  UPDATE pg_temp.kitchen_settlement_queue
  SET consumed = true
  WHERE seq = v_queue.seq;

  RETURN jsonb_build_object(
    'success', true,
    'units_deducted', v_units,
    'raw_materials_deducted', v_raws,
    'ready_products_deducted', v_products,
    'total_cost', v_total_cost,
    'errors', '[]'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._finalize_kitchen_sale_settlement(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF to_regclass('pg_temp.kitchen_settlement_queue') IS NULL
     OR EXISTS (SELECT 1 FROM pg_temp.kitchen_settlement_queue WHERE NOT consumed) THEN
    RAISE EXCEPTION 'KITCHEN_SETTLEMENT_INCOMPLETE';
  END IF;

  UPDATE public.order_kitchen_inventory_events e
  SET settled_sale_id = p_sale_id
  WHERE e.id = ANY(
    ARRAY(
      SELECT DISTINCT unnest(q.event_ids)
      FROM pg_temp.kitchen_settlement_queue q
    )
  )
    AND e.settled_sale_id IS NULL;

  PERFORM set_config('app.kitchen_inventory_settlement', 'off', true);
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sale(
  p_invoice_number text,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_salesperson_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_type text,
  p_tax_amount numeric,
  p_bonus_amount numeric,
  p_total numeric,
  p_paid_amount numeric,
  p_payment_method text,
  p_status text,
  p_items jsonb,
  p_shift_id uuid DEFAULT NULL::uuid,
  p_order_type text DEFAULT 'takeaway'::text,
  p_table_id uuid DEFAULT NULL::uuid,
  p_order_id uuid DEFAULT NULL::uuid,
  p_guest_count integer DEFAULT NULL::integer
)
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
      jsonb_build_object('action_type','discount','discount_amount',v_header_discount,'order_id',p_order_id),
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
    p_salesperson_id,
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
$function$;
