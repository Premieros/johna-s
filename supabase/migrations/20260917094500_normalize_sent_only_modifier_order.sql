-- Forward-only fix for sent-only settlement modifier matching.
-- The preview and client payload must compare modifier ids as sets, not by array order.

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

  BEGIN
    SELECT COALESCE(jsonb_agg(x.shape ORDER BY x.shape::text), '[]'::jsonb)
    INTO v_preview_shape
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
      FROM jsonb_array_elements(COALESCE(v_preview->'items', '[]'::jsonb)) j(item)
    ) x;

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
