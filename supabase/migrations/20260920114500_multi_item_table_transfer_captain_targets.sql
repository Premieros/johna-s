-- Multi-item table transfer + strict Captain Order operator targets.
-- No inventory or KDS mutation is performed by item transfer.
-- Executor authorization remains Permission-First via pos.order.transfer.
-- Captain role labels below classify eligible transfer TARGETS only; they are
-- not used to authorize the executing user.

CREATE OR REPLACE FUNCTION public._is_branch_captain_order_user(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.role = u.role
    WHERE u.id = p_user_id
      AND u.is_active = true
      -- "same branch only" means the user's home branch, not merely an
      -- additional branch-access grant.
      AND u.branch_id = p_branch_id
      AND r.is_active = true
      AND r.scope = 'branch'
      AND r.branch_id = p_branch_id
      AND (
        regexp_replace(lower(btrim(COALESCE(r.name_ar,''))), '\\s+', ' ', 'g') LIKE 'كابتن اوردر%'
        OR lower(btrim(COALESCE(r.name_en,''))) LIKE 'cap%'
      )
      AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.view'
      AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.order.create'
      AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.order.edit'
      AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.send_kitchen'
  );
$function$;

REVOKE ALL ON FUNCTION public._is_branch_captain_order_user(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._is_branch_captain_order_user(uuid,uuid) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.list_pos_order_transfer_targets(p_order_id uuid)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN RETURN; END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_order.id IS NULL OR v_order.status NOT IN ('open','held') THEN RETURN; END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(NULLIF(trim(u.full_name),''),NULLIF(trim(u.username),''),u.email,'—')
  FROM public.users u
  WHERE u.id IS DISTINCT FROM v_order.cashier_id
    AND public._is_branch_captain_order_user(u.id, v_order.branch_id)
  ORDER BY COALESCE(NULLIF(trim(u.full_name),''),NULLIF(trim(u.username),''),u.email);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_pos_order_transfer_targets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pos_order_transfer_targets(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_order_operator(
  p_order_id uuid,
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_executor_id uuid := auth.uid();
  v_source_ok boolean := false;
  v_table_ok boolean := true;
BEGIN
  IF v_executor_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.order.transfer');
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF v_order.status NOT IN ('open','held') THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  IF v_order.cashier_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.users u
      WHERE u.id = v_order.cashier_id
        AND u.is_active = true
        AND (
          u.branch_id = v_order.branch_id
          OR EXISTS(
            SELECT 1 FROM public.user_branch_access uba
            WHERE uba.user_id = u.id AND uba.branch_id = v_order.branch_id
          )
        )
    ) INTO v_source_ok;
    IF NOT v_source_ok THEN
      RETURN jsonb_build_object('success',false,'error','SOURCE_OPERATOR_NOT_IN_BRANCH');
    END IF;
  END IF;

  IF v_order.cashier_id = p_target_user_id THEN
    RETURN jsonb_build_object('success',false,'error','SAME_OPERATOR');
  END IF;

  IF NOT public._is_branch_captain_order_user(p_target_user_id, v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','TARGET_USER_NOT_BRANCH_CAPTAIN');
  END IF;

  IF v_order.table_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.dining_tables t
      WHERE t.id = v_order.table_id AND t.branch_id = v_order.branch_id
    ) INTO v_table_ok;
    IF NOT v_table_ok THEN
      RETURN jsonb_build_object('success',false,'error','TABLE_BRANCH_MISMATCH');
    END IF;
  END IF;

  PERFORM set_config('app.pos_operator_transfer_order_id',v_order.id::text,true);
  PERFORM set_config('app.pos_operator_transfer_target_id',p_target_user_id::text,true);
  UPDATE public.orders
  SET cashier_id = p_target_user_id, updated_at = now()
  WHERE id = v_order.id;
  PERFORM set_config('app.pos_operator_transfer_order_id','',true);
  PERFORM set_config('app.pos_operator_transfer_target_id','',true);

  INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
  VALUES(
    v_executor_id,
    'ORDER_OPERATOR_TRANSFERRED',
    'order',
    v_order.id,
    jsonb_build_object(
      'from_cashier_id',v_order.cashier_id,
      'to_cashier_id',p_target_user_id,
      'table_id',v_order.table_id
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success',true,
    'order_id',v_order.id,
    'branch_id',v_order.branch_id,
    'table_id',v_order.table_id,
    'from_cashier_id',v_order.cashier_id,
    'to_cashier_id',p_target_user_id,
    'transferred_by',v_executor_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_operator(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_operator(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_order_items_to_table(
  p_order_id uuid,
  p_order_item_ids uuid[],
  p_target_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
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
  v_moved_tax numeric(14,4) := 0;
  v_remaining integer := 0;
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

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id=p_order_id AND o.status IN ('open','held')
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
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

  IF EXISTS (
    SELECT 1
    FROM public.order_kitchen_sends s
    WHERE s.order_item_id=ANY(v_item_ids)
  ) THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','ITEM_ALREADY_SENT',
      'detail','Sent kitchen lines remain attached to their original order.'
    );
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

  SELECT id,order_number
  INTO v_target_order_id,v_target_order_number
  FROM public.orders o
  WHERE o.table_id=p_target_table_id
    AND o.branch_id=v_order.branch_id
    AND o.status IN ('open','held')
    AND o.id<>p_order_id
  ORDER BY o.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_target_order_id IS NULL THEN
    v_number := public.next_document_number('order');
    IF COALESCE((v_number->>'success')::boolean,false) IS NOT TRUE THEN
      RETURN jsonb_build_object('success',false,'error','NUMBERING_FAILED','detail',v_number->>'error');
    END IF;
    v_target_order_number := v_number->>'number';

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
    RETURNING id INTO v_target_order_id;
  END IF;

  SELECT COALESCE(sum(oi.quantity*oi.unit_price),0)
  INTO v_source_line_subtotal
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id;

  SELECT COALESCE(sum(oi.quantity*oi.unit_price),0)
  INTO v_moved_line_subtotal
  FROM public.order_items oi
  WHERE oi.order_id=p_order_id AND oi.id=ANY(v_item_ids);

  v_ratio := CASE
    WHEN v_source_line_subtotal > 0
      THEN LEAST(1,GREATEST(0,v_moved_line_subtotal/v_source_line_subtotal))
    ELSE 0
  END;
  v_moved_discount := round(COALESCE(v_order.discount_amount,0)*v_ratio,4);
  v_moved_tax := round(COALESCE(v_order.tax_amount,0)*v_ratio,4);

  UPDATE public.order_items
  SET order_id=v_target_order_id
  WHERE order_id=p_order_id AND id=ANY(v_item_ids);

  UPDATE public.orders
  SET discount_amount=GREATEST(COALESCE(discount_amount,0)-v_moved_discount,0),
      tax_amount=GREATEST(COALESCE(tax_amount,0)-v_moved_tax,0),
      updated_at=now()
  WHERE id=p_order_id;

  UPDATE public.orders
  SET discount_amount=COALESCE(discount_amount,0)+v_moved_discount,
      tax_amount=COALESCE(tax_amount,0)+v_moved_tax,
      updated_at=now()
  WHERE id=v_target_order_id;

  PERFORM public._recalc_open_order_totals(p_order_id);
  PERFORM public._recalc_open_order_totals(v_target_order_id);

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

  INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)
  VALUES(
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
      'inventory_changed',false,
      'kds_changed',false
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success',true,
    'source_order_id',p_order_id,
    'target_order_id',v_target_order_id,
    'target_order_number',v_target_order_number,
    'moved_item_count',v_requested_count,
    'source_order_empty',v_remaining=0,
    'inventory_changed',false,
    'kds_changed',false
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','TRANSACTION_FAILED','detail',SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_items_to_table(uuid,uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_items_to_table(uuid,uuid[],uuid) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
