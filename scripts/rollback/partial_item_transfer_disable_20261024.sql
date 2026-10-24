-- Retain additive lineage and origin-aware void/refund compatibility. No business data is rewritten.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.transfer_order_items_to_table(uuid,uuid[],uuid)'::regprocedure) NOT IN ('c843677240e9ba463d35f79e06fc1f13') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:transfer_order_items_to_table'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.transfer_order_items_to_table(p_order_id uuid, p_order_item_ids uuid[], p_target_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request jsonb:=NULLIF(current_setting('app.pos_item_transfer_quantity_request',true),'')::jsonb;
  v_operation uuid; v_request_hash text; v_previous public.audit_log%ROWTYPE; v_result jsonb;
  v_requested_ids uuid[]; v_move_ids uuid[]:='{}'; v_moves jsonb:='[]'; v_line record; v_spec jsonb; v_take numeric; v_available numeric; v_new_id uuid; v_branch_hint uuid;
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_target public.dining_tables%ROWTYPE;
  v_item_ids uuid[];
  v_requested_count integer := 0;
  v_found_count integer := 0;
  v_target_order_id uuid;
  v_target_order_number text;
  v_number jsonb;
  v_source_table_id uuid;
  v_source_line_subtotal numeric(14,4) := 0;
  v_moved_line_subtotal numeric(14,4) := 0;
  v_ratio numeric(18,8) := 0;
  v_moved_discount numeric(14,4) := 0;
  v_source_subtotal_after numeric(14,2) := 0;
  v_target_subtotal_after numeric(14,2) := 0;
  v_source_discount_after numeric(14,2) := 0;
  v_target_discount_after numeric(14,2) := 0;
  v_source_tax_after numeric(14,2) := 0;
  v_target_tax_after numeric(14,2) := 0;
  v_target_discount_before numeric(14,2) := 0;
  v_tax_enabled boolean := false;
  v_tax_rate numeric := 0;
  v_remaining integer := 0;
  v_moved_sent_count integer := 0;
  v_source_sent_remaining integer := 0;
  v_target_owner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=v_uid AND u.is_active=true) THEN
    RETURN jsonb_build_object('success',false,'error','USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.order.transfer');
  END IF;

  IF v_request IS NOT NULL THEN
    IF jsonb_typeof(v_request)<>'object' OR jsonb_typeof(v_request->'quantities') IS DISTINCT FROM 'array'
      OR NULLIF(v_request->>'operation_id','') IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
    v_operation:=(v_request->>'operation_id')::uuid;
    v_request_hash:=md5(jsonb_build_object('source',p_order_id,'target',p_target_table_id,'ids',to_jsonb(p_order_item_ids),'request',v_request)::text);
    SELECT branch_id INTO v_branch_hint FROM public.orders WHERE id=p_order_id;
    IF v_branch_hint IS NULL OR NOT public.user_may_access_branch(v_branch_hint) THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND'); END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('pos-quantity-transfer:'||v_branch_hint::text,0)) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_BUSY'); END IF;
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id=p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF v_operation IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.audit_log WHERE id=v_operation;
    IF FOUND THEN
      IF v_previous.user_id IS DISTINCT FROM v_uid OR v_previous.branch_id IS DISTINCT FROM v_order.branch_id
        OR v_previous.entity_id IS DISTINCT FROM p_order_id OR v_previous.action<>'ORDER_ITEMS_TABLE_TRANSFERRED'
        OR v_previous.details->>'transfer_request_hash' IS DISTINCT FROM v_request_hash THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_OPERATION_CONFLICT'); END IF;
      RETURN (v_previous.details->'result')||jsonb_build_object('replayed',true,'snapshot',public._pos_transfer_pair_snapshot(p_order_id,(v_previous.details->>'target_order_id')::uuid));
    END IF;
  END IF;
  IF v_request IS NOT NULL THEN RETURN jsonb_build_object('success',false,'error','PARTIAL_TRANSFER_DISABLED'); END IF;
  IF v_order.status NOT IN ('open','held') THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE'); END IF;

  IF v_order.order_type <> 'dine_in' OR v_order.table_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','SOURCE_NOT_DINE_IN');
  END IF;

  SELECT array_agg(DISTINCT x)
  INTO v_item_ids
  FROM unnest(COALESCE(p_order_item_ids, ARRAY[]::uuid[])) AS x
  WHERE x IS NOT NULL;

  v_requested_count := COALESCE(cardinality(v_item_ids),0);
  IF v_requested_count = 0 THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_ITEMS_REQUIRED');
  END IF;

  -- Lock every selected row before validating/moving.
  PERFORM oi.id
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id AND oi.id=ANY(v_item_ids)
  FOR UPDATE;

  SELECT count(*)
  INTO v_found_count
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id AND oi.id=ANY(v_item_ids);

  IF v_found_count <> v_requested_count THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_ITEM_NOT_FOUND');
  END IF;

  v_requested_ids:=v_item_ids;
  IF v_request IS NOT NULL THEN
    IF jsonb_array_length(v_request->'quantities')<>v_requested_count
      OR (SELECT count(DISTINCT value->>'order_item_id') FROM jsonb_array_elements(v_request->'quantities'))<>v_requested_count THEN
      RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
    FOR v_line IN SELECT * FROM public.order_items WHERE order_id=p_order_id AND id=ANY(v_item_ids) ORDER BY id LOOP
      SELECT value INTO v_spec FROM jsonb_array_elements(v_request->'quantities') WHERE value->>'order_item_id'=v_line.id::text;
      IF v_spec IS NULL OR jsonb_typeof(v_spec->'expected') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
      v_take:=(v_spec->>'quantity')::numeric;
      IF v_take IS NULL OR v_take<=0 OR round(v_take,4)<>v_take OR v_take::text IN ('NaN','Infinity','-Infinity') THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_QUANTITY'); END IF;
      IF v_spec->'expected' IS DISTINCT FROM jsonb_build_object('quantity',v_line.quantity,'product_id',v_line.product_id,'unit_name',v_line.unit_name,
        'unit_price',v_line.unit_price,'discount_amount',v_line.discount_amount,'bonus_quantity',v_line.bonus_quantity,'notes',COALESCE(v_line.notes,''),
        'modifier_option_ids',COALESCE(to_jsonb(v_line.modifier_option_ids),'[]'::jsonb)) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_SOURCE_CHANGED'); END IF;
      SELECT v_line.quantity-COALESCE(sum(sent_quantity-voided_quantity) FILTER(WHERE settled_sale_id IS NOT NULL),0) INTO v_available
        FROM public.order_kitchen_inventory_events WHERE order_id=p_order_id AND order_item_id=v_line.id;
      IF v_take>v_available THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_QUANTITY_UNAVAILABLE','available_quantity',v_available,'order_item_id',v_line.id); END IF;
    END LOOP;
  END IF;

  SELECT * INTO v_target
  FROM public.dining_tables t
  WHERE t.id=p_target_table_id
    AND t.branch_id=v_order.branch_id
    AND t.is_active=true
  FOR UPDATE;

  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','TARGET_TABLE_NOT_FOUND');
  END IF;
  IF v_target.id=v_order.table_id THEN
    RETURN jsonb_build_object('success',false,'error','SAME_TABLE');
  END IF;

  SELECT id,order_number,cashier_id,COALESCE(discount_amount,0)
  INTO v_target_order_id,v_target_order_number,v_target_owner_id,v_target_discount_before
  FROM public.orders o
  WHERE o.table_id=p_target_table_id
    AND o.branch_id=v_order.branch_id
    AND o.status IN ('open','held')
    AND o.id<>p_order_id
  ORDER BY o.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_request IS NOT NULL AND (EXISTS(SELECT 1 FROM public.order_kitchen_inventory_events WHERE order_id IN(p_order_id,v_target_order_id) AND settled_sale_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.orders WHERE id IN(p_order_id,v_target_order_id) AND payment_status IN ('partial','paid'))) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_PAID_ORDER_REQUIRES_SETTLEMENT'); END IF;

  IF v_target_order_id IS NULL THEN
    v_number := public.next_document_number('order');
    IF COALESCE((v_number->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN jsonb_build_object('success',false,'error','NUMBERING_FAILED','detail',v_number->>'error');
    END IF;
    v_target_order_number := v_number->>'number';

    PERFORM set_config('app.pos_item_transfer_new_order_owner_id',COALESCE(v_order.cashier_id,v_uid)::text,true);
    PERFORM set_config('app.pos_item_transfer_branch_id',v_order.branch_id::text,true);
    PERFORM set_config('app.pos_item_transfer_source_order_id',p_order_id::text,true);
    PERFORM set_config('app.pos_item_transfer_source_table_id',v_order.table_id::text,true);
    PERFORM set_config('app.pos_item_transfer_target_table_id',p_target_table_id::text,true);

    INSERT INTO public.orders(
      order_number,branch_id,order_type,status,table_id,customer_id,
      cashier_id,guest_count,notes,subtotal,discount_amount,discount_type,
      tax_amount,total
    ) VALUES (
      v_target_order_number,
      v_order.branch_id,
      'dine_in',
      'open',
      p_target_table_id,
      v_order.customer_id,
      COALESCE(v_order.cashier_id,v_uid),
      NULL,
      NULL,
      0,0,'amount',0,0
    )
    RETURNING id,cashier_id,COALESCE(discount_amount,0)
    INTO v_target_order_id,v_target_owner_id,v_target_discount_before;

    PERFORM set_config('app.pos_item_transfer_new_order_owner_id','',true);
    PERFORM set_config('app.pos_item_transfer_branch_id','',true);
  END IF;

  IF v_request IS NOT NULL THEN
    FOR v_line IN SELECT * FROM public.order_items WHERE order_id=p_order_id AND id=ANY(v_requested_ids) ORDER BY id LOOP
      SELECT value INTO v_spec FROM jsonb_array_elements(v_request->'quantities') WHERE value->>'order_item_id'=v_line.id::text;
      v_take:=(v_spec->>'quantity')::numeric;
      v_new_id:=CASE WHEN v_take=v_line.quantity THEN v_line.id ELSE public._pos_split_transfer_line(p_order_id,v_line.id,v_take,v_target_order_id) END;
      v_move_ids:=array_append(v_move_ids,v_new_id);
      v_moves:=v_moves||jsonb_build_array(jsonb_build_object('source_item_id',v_line.id,'moved_item_id',v_new_id,'quantity',v_take));
    END LOOP;
    v_item_ids:=v_move_ids;
  END IF;

  SELECT COALESCE(sum(COALESCE(oi.total,oi.quantity*oi.unit_price)),0)
  INTO v_source_line_subtotal
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id;

  SELECT COALESCE(sum(COALESCE(oi.total,oi.quantity*oi.unit_price)),0)
  INTO v_moved_line_subtotal
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id AND oi.id=ANY(v_item_ids);

  v_ratio := CASE
    WHEN v_source_line_subtotal > 0
      THEN LEAST(1,GREATEST(0,v_moved_line_subtotal/v_source_line_subtotal))
    ELSE 0
  END;
  -- Allocate the source order-level discount with the moved merchandise.
  -- Tax is NOT moved proportionally: it is recalculated authoritatively below
  -- from each order's resulting subtotal/discount and branch tax settings.
  v_moved_discount := round(COALESCE(v_order.discount_amount,0)*v_ratio,2);

  SELECT count(*)
  INTO v_moved_sent_count
  FROM public.order_kitchen_sends s
  WHERE s.order_item_id=ANY(v_item_ids);

  PERFORM set_config('app.pos_item_transfer_branch_id',v_order.branch_id::text,true);
  PERFORM set_config('app.pos_item_transfer_source_order_id',p_order_id::text,true);
  PERFORM set_config('app.pos_item_transfer_target_order_id',v_target_order_id::text,true);
  PERFORM set_config('app.pos_item_transfer_source_table_id',v_order.table_id::text,true);
  PERFORM set_config('app.pos_item_transfer_target_table_id',p_target_table_id::text,true);
  PERFORM set_config('app.pos_item_transfer_item_ids',array_to_string(v_item_ids,','),true);

  UPDATE public.order_items
  SET order_id=v_target_order_id
  WHERE order_id=p_order_id AND id=ANY(v_item_ids);

  -- Preserve the original kitchen execution and stock deduction while moving
  -- its order/table ownership. sent_by/created_by/timestamps/quantities remain
  -- unchanged; only the owning order reference follows the moved line.
  UPDATE public.order_kitchen_sends
  SET order_id=v_target_order_id
  WHERE order_item_id=ANY(v_item_ids)
    AND order_id=p_order_id;

  UPDATE public.order_kitchen_inventory_events
  SET order_id=v_target_order_id
  WHERE order_item_id=ANY(v_item_ids)
    AND order_id=p_order_id;

  IF v_request IS NOT NULL THEN
    UPDATE public.order_kitchen_served_quantities SET order_id=v_target_order_id WHERE order_id=p_order_id AND order_item_id=ANY(v_item_ids);
  END IF;

  SELECT round(COALESCE(sum(COALESCE(oi.total,oi.quantity*oi.unit_price)),0),2)
  INTO v_source_subtotal_after
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id;

  SELECT round(COALESCE(sum(COALESCE(oi.total,oi.quantity*oi.unit_price)),0),2)
  INTO v_target_subtotal_after
  FROM public.order_items oi
  WHERE oi.order_id=v_target_order_id;

  v_source_discount_after :=
    LEAST(v_source_subtotal_after,GREATEST(round(COALESCE(v_order.discount_amount,0)-v_moved_discount,2),0));
  v_target_discount_after :=
    LEAST(v_target_subtotal_after,GREATEST(round(COALESCE(v_target_discount_before,0)+v_moved_discount,2),0));

  SELECT COALESCE(t.tax_enabled,false),COALESCE(t.tax_rate,0)
  INTO v_tax_enabled,v_tax_rate
  FROM public._effective_branch_tax(v_order.branch_id) t;

  v_source_tax_after := CASE
    WHEN v_tax_enabled
      THEN round(GREATEST(v_source_subtotal_after-v_source_discount_after,0)*v_tax_rate/100,2)
    ELSE 0
  END;
  v_target_tax_after := CASE
    WHEN v_tax_enabled
      THEN round(GREATEST(v_target_subtotal_after-v_target_discount_after,0)*v_tax_rate/100,2)
    ELSE 0
  END;

  UPDATE public.orders
  SET subtotal=v_source_subtotal_after,
      discount_amount=v_source_discount_after,
      tax_amount=v_source_tax_after,
      total=round(GREATEST(v_source_subtotal_after-v_source_discount_after+v_source_tax_after,0),2),
      updated_at=now()
  WHERE id=p_order_id;

  UPDATE public.orders
  SET subtotal=v_target_subtotal_after,
      discount_amount=v_target_discount_after,
      tax_amount=v_target_tax_after,
      total=round(GREATEST(v_target_subtotal_after-v_target_discount_after+v_target_tax_after,0),2),
      updated_at=now()
  WHERE id=v_target_order_id;

  IF v_moved_sent_count > 0 THEN
    -- KDS reads order-level kitchen_status but item-level send rows. A moved
    -- sent line must therefore keep the target order visible without creating
    -- another send/print/inventory event.
    UPDATE public.orders
    SET kitchen_status = CASE
          WHEN v_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends oks LEFT JOIN public.order_kitchen_served_quantities ksb ON ksb.order_id=oks.order_id AND ksb.order_item_id=oks.order_item_id WHERE oks.order_id=v_target_order_id AND oks.sent_quantity>COALESCE(ksb.served_quantity,0)) THEN 'served'
          WHEN kitchen_status IN ('sent','cooking','ready') THEN kitchen_status
          ELSE 'sent'
        END,
        kitchen_sent_at = COALESCE(kitchen_sent_at, (
          SELECT min(s.sent_at)
          FROM public.order_kitchen_sends s
          WHERE s.order_id=v_target_order_id
        )),
        updated_at=now()
    WHERE id=v_target_order_id;

    SELECT count(*)
    INTO v_source_sent_remaining
    FROM public.order_kitchen_sends s
    WHERE s.order_id=p_order_id
      AND COALESCE(s.sent_quantity,0)>0;

    IF v_source_sent_remaining=0 THEN
      UPDATE public.orders
      SET kitchen_status='pending',
          kitchen_sent_at=NULL,
          kitchen_ready_at=NULL,
          updated_at=now()
      WHERE id=p_order_id
        AND status IN ('open','held');
    END IF;
  END IF;

  UPDATE public.dining_tables
  SET status='occupied',updated_at=now()
  WHERE id=p_target_table_id;

  SELECT count(*)
  INTO v_remaining
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id;

  v_source_table_id := v_order.table_id;
  IF v_remaining=0 THEN
    UPDATE public.orders
    SET status='cancelled',updated_at=now()
    WHERE id=p_order_id;

    IF NOT EXISTS(
      SELECT 1 FROM public.orders o
      WHERE o.table_id=v_source_table_id
        AND o.status IN ('open','held')
        AND o.id<>p_order_id
    ) THEN
      UPDATE public.dining_tables
      SET status='vacant',updated_at=now()
      WHERE id=v_source_table_id;
    END IF;
  END IF;

  PERFORM set_config('app.pos_item_transfer_new_order_owner_id','',true);
  PERFORM set_config('app.pos_item_transfer_branch_id','',true);
  PERFORM set_config('app.pos_item_transfer_source_order_id','',true);
  PERFORM set_config('app.pos_item_transfer_target_order_id','',true);
  PERFORM set_config('app.pos_item_transfer_source_table_id','',true);
  PERFORM set_config('app.pos_item_transfer_target_table_id','',true);
  PERFORM set_config('app.pos_item_transfer_item_ids','',true);

  v_result:=jsonb_build_object(
    'success',true,
    'source_order_id',p_order_id,
    'target_order_id',v_target_order_id,
    'target_order_number',v_target_order_number,
    'moved_item_count',v_requested_count,'quantity_transfers',v_moves,
    'moved_sent_item_count',v_moved_sent_count,
    'target_owner_id',v_target_owner_id,
    'source_order_empty',v_remaining=0,
    'inventory_changed',false,
    'kds_reassigned',v_moved_sent_count>0,
    'kds_resent',false
  );

  INSERT INTO public.audit_log(id,user_id,action,entity,entity_id,details,branch_id)
  VALUES(
    COALESCE(v_operation,gen_random_uuid()),
    v_uid,
    'ORDER_ITEMS_TABLE_TRANSFERRED',
    'order',
    p_order_id,
    jsonb_build_object(
      'order_item_ids',to_jsonb(v_item_ids),
      'item_count',v_requested_count,
      'source_table_id',v_source_table_id,
      'target_table_id',p_target_table_id,
      'target_order_id',v_target_order_id,
      'target_owner_id',v_target_owner_id,
      'moved_sent_item_count',v_moved_sent_count,
      'inventory_changed',false,
      'kds_reassigned',v_moved_sent_count>0,
      'kds_resent',false,'quantity_transfers',v_moves,'transfer_request_hash',v_request_hash,'result',v_result
    ),
    v_order.branch_id
  );

  RETURN CASE WHEN v_request IS NOT NULL THEN v_result||jsonb_build_object('snapshot',public._pos_transfer_pair_snapshot(p_order_id,v_target_order_id)) ELSE v_result END;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','TRANSACTION_FAILED','detail',SQLERRM);
END;
$function$;
COMMIT;
