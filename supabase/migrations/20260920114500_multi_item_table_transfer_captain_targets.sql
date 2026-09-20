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

-- Extend the ownership guard only for the exact item-transfer RPC context.
-- This keeps Permission-First authorization on pos.order.transfer without
-- granting users.manage or a general cross-user mutation bypass.
CREATE OR REPLACE FUNCTION public.guard_pos_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_is_service_role boolean:=COALESCE(current_setting('role',true),'')='service_role'
    OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_is_db_admin boolean:=COALESCE(current_setting('role',true),'') IN('','none','postgres','supabase_admin')
    AND session_user IN('postgres','supabase_admin');
  v_can_manage_others boolean:=false;
  v_owner_id uuid;
  v_branch_id uuid;
  v_new_owner_id uuid;
  v_new_branch_id uuid;
  v_transfer_context boolean:=false;
  v_item_transfer_context boolean:=false;
  v_new_order_item_transfer_context boolean:=false;
  v_owner_mutation boolean:=false;
BEGIN
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF public.is_pos_admin() THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_can_manage_others:=public.can_manage_other_pos_orders();

  IF TG_TABLE_NAME='orders' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.user_may_access_branch(NEW.branch_id) THEN
        RAISE EXCEPTION 'BRANCH_MISMATCH';
      END IF;
      IF NEW.cashier_id IS NULL THEN
        NEW.cashier_id:=v_uid;
      ELSIF NEW.cashier_id IS DISTINCT FROM v_uid THEN
        v_new_order_item_transfer_context :=
          COALESCE(current_setting('app.pos_item_transfer_new_order_owner_id',true),'')=NEW.cashier_id::text
          AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=NEW.branch_id::text
          AND public.can_permission('pos.order.transfer');
        IF NOT v_new_order_item_transfer_context THEN
          RAISE EXCEPTION 'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN';
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP='DELETE' THEN
      IF NOT public.user_may_access_branch(OLD.branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
      IF OLD.cashier_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;

    IF NOT public.user_may_access_branch(OLD.branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;

    v_owner_mutation:=
      (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[]);

    IF NEW.cashier_id IS DISTINCT FROM OLD.cashier_id THEN
      v_transfer_context:=
        COALESCE(current_setting('app.pos_operator_transfer_order_id',true),'')=OLD.id::text
        AND COALESCE(current_setting('app.pos_operator_transfer_target_id',true),'')=COALESCE(NEW.cashier_id::text,'')
        AND public.can_permission('pos.order.transfer');
      IF NOT v_transfer_context THEN RAISE EXCEPTION 'ORDER_TRANSFER_RPC_REQUIRED'; END IF;
      IF
        (to_jsonb(NEW)-ARRAY['cashier_id','kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[])
        IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['cashier_id','kitchen_status','kitchen_sent_at','kitchen_ready_at','station','print_status','printed_at','updated_at']::text[])
      THEN
        RAISE EXCEPTION 'ORDER_TRANSFER_MUTATION_SCOPE';
      END IF;
      RETURN NEW;
    END IF;

    IF v_owner_mutation AND OLD.cashier_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;
    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.transfer';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_items' THEN
    IF TG_OP='INSERT' THEN
      SELECT o.cashier_id,o.branch_id INTO v_owner_id,v_branch_id
      FROM public.orders o WHERE o.id=NEW.order_id;
      IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
      IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
      IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN NEW;
    END IF;

    SELECT o.cashier_id,o.branch_id INTO v_owner_id,v_branch_id
    FROM public.orders o WHERE o.id=OLD.order_id;
    IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;

    IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
        AND public.can_permission('pos.order.transfer');
    END IF;

    IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others AND NOT v_item_transfer_context THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;

    IF TG_OP='DELETE' THEN RETURN OLD; END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      SELECT o.cashier_id,o.branch_id INTO v_new_owner_id,v_new_branch_id
      FROM public.orders o WHERE o.id=NEW.order_id;
      IF v_new_branch_id IS NULL THEN RAISE EXCEPTION 'TARGET_ORDER_NOT_FOUND'; END IF;
      IF v_new_branch_id IS DISTINCT FROM v_branch_id THEN RAISE EXCEPTION 'CROSS_BRANCH_ORDER_ITEM_MOVE'; END IF;
      IF v_new_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others AND NOT v_item_transfer_context THEN
        RAISE EXCEPTION 'TARGET_ORDER_OPERATOR_REQUIRED';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='dining_tables' THEN
    IF TG_OP='DELETE' THEN
      IF NOT v_can_manage_others AND EXISTS(
        SELECT 1 FROM public.orders o
        WHERE o.table_id=OLD.id AND o.status IN('open','held')
          AND o.cashier_id IS DISTINCT FROM v_uid
      ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF NOT v_can_manage_others AND EXISTS(
        SELECT 1 FROM public.orders o
        WHERE o.table_id=OLD.id AND o.status IN('open','held')
          AND o.cashier_id IS DISTINCT FROM v_uid
      ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_pos_operator_ownership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_pos_operator_ownership() TO service_role;

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
  v_moved_sent_count integer := 0;
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

  SELECT id,order_number,cashier_id
  INTO v_target_order_id,v_target_order_number,v_target_owner_id
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

    PERFORM set_config('app.pos_item_transfer_new_order_owner_id',COALESCE(v_order.cashier_id,v_uid)::text,true);
    PERFORM set_config('app.pos_item_transfer_branch_id',v_order.branch_id::text,true);

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
    RETURNING id,cashier_id INTO v_target_order_id,v_target_owner_id;

    PERFORM set_config('app.pos_item_transfer_new_order_owner_id','',true);
    PERFORM set_config('app.pos_item_transfer_branch_id','',true);
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

  SELECT count(*)
  INTO v_moved_sent_count
  FROM public.order_kitchen_sends s
  WHERE s.order_item_id=ANY(v_item_ids);

  PERFORM set_config('app.pos_item_transfer_source_order_id',p_order_id::text,true);
  PERFORM set_config('app.pos_item_transfer_target_order_id',v_target_order_id::text,true);

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

  PERFORM set_config('app.pos_item_transfer_source_order_id','',true);
  PERFORM set_config('app.pos_item_transfer_target_order_id','',true);

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
      'target_owner_id',v_target_owner_id,
      'moved_sent_item_count',v_moved_sent_count,
      'inventory_changed',false,
      'kds_reassigned',v_moved_sent_count>0,
      'kds_resent',false
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success',true,
    'source_order_id',p_order_id,
    'target_order_id',v_target_order_id,
    'target_order_number',v_target_order_number,
    'moved_item_count',v_requested_count,
    'moved_sent_item_count',v_moved_sent_count,
    'target_owner_id',v_target_owner_id,
    'source_order_empty',v_remaining=0,
    'inventory_changed',false,
    'kds_reassigned',v_moved_sent_count>0,
    'kds_resent',false
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','TRANSACTION_FAILED','detail',SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_items_to_table(uuid,uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_items_to_table(uuid,uuid[],uuid) TO authenticated, service_role;

NOTIFY pgrst,'reload schema';
