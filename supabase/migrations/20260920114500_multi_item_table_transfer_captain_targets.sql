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

  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id=p_target_user_id
      AND u.is_active=true
      AND u.branch_id=v_order.branch_id
  ) THEN
    RETURN jsonb_build_object('success',false,'error','TARGET_USER_NOT_IN_BRANCH');
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
      'table_id',v_order.table_id,
      'transferred_by',v_executor_id,
      'transferred_at',now()
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
  v_order_item_transfer_context boolean:=false;
  v_table_item_transfer_context boolean:=false;
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

    v_order_item_transfer_context :=
      (
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.id::text
        OR COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=OLD.id::text
      )
      AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
      AND public.can_permission('pos.order.transfer');

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

    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_order_item_transfer_context THEN
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
    v_table_item_transfer_context :=
      (
        COALESCE(current_setting('app.pos_item_transfer_source_table_id',true),'')=OLD.id::text
        OR COALESCE(current_setting('app.pos_item_transfer_target_table_id',true),'')=OLD.id::text
      )
      AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
      AND public.can_permission('pos.order.transfer');

    IF TG_OP='DELETE' THEN
      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND EXISTS(
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
      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND EXISTS(
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

-- Allow the exact table-item transfer RPC to move an order-item row with
-- pos.order.transfer. Outside that scoped context, existing split/edit rules stay unchanged.
CREATE OR REPLACE FUNCTION public.enforce_pos_permission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_print_only_mutation boolean := false;
  v_item_transfer_context boolean := false;
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
    IF NOT public.can_permission('pos.send_kitchen') THEN
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
        ) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
        END IF;
      ELSIF NEW.status='completed' THEN
        IF NOT public.can_permission('pos.payment.take') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take'; END IF;
        IF NOT public.can_permission('pos.order.edit')
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

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit') THEN
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
    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.void') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.void'; END IF;
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
    ELSIF NOT public.can_permission('pos.order.edit') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_pos_permission_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_pos_permission_mutation() TO service_role;

-- Preserve the existing kitchen-send ownership boundary, but permit order_id
-- reassignment only for selected lines inside transfer_order_items_to_table.
CREATE OR REPLACE FUNCTION public.guard_kitchen_send_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean :=
    COALESCE(current_setting('role',true),'')='service_role'
    OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_is_db_admin boolean :=
    COALESCE(current_setting('role',true),'') IN ('','none','postgres','supabase_admin')
    AND session_user IN ('postgres','supabase_admin');
  v_order_id uuid;
  v_owner_id uuid;
  v_branch_id uuid;
  v_item_transfer_context boolean := false;
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

  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    v_item_transfer_context :=
      COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
      AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
      AND COALESCE(current_setting('app.pos_item_transfer_item_ids',true),'') LIKE '%' || OLD.order_item_id::text || '%'
      AND public.can_permission('pos.order.transfer');

    IF v_item_transfer_context THEN
      RETURN NEW;
    END IF;
  END IF;

  v_order_id := CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.cashier_id,o.branch_id
  INTO v_owner_id,v_branch_id
  FROM public.orders o
  WHERE o.id=v_order_id;

  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
  IF v_owner_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED'; END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_kitchen_send_operator_ownership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_kitchen_send_operator_ownership() TO service_role;

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
