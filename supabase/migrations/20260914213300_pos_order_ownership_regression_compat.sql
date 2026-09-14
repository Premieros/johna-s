-- Regression compatibility for POS ownership hardening.
-- Keeps manager direct-open choice (permission-derived) while preserving
-- established KDS, print-status, transfer validation, and kitchen-send contracts.

CREATE OR REPLACE FUNCTION public.guard_pos_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_is_db_admin boolean :=
    COALESCE(current_setting('role', true), '') IN ('', 'none', 'postgres', 'supabase_admin')
    AND session_user IN ('postgres', 'supabase_admin');
  v_can_manage_others boolean := false;
  v_owner_id uuid;
  v_branch_id uuid;
  v_new_owner_id uuid;
  v_new_branch_id uuid;
  v_transfer_context boolean := false;
  v_owner_mutation boolean := false;
BEGIN
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF public.is_pos_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_can_manage_others := public.can_manage_other_pos_orders();

  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.user_may_access_branch(NEW.branch_id) THEN
        RAISE EXCEPTION 'BRANCH_MISMATCH';
      END IF;
      IF NEW.cashier_id IS NULL THEN
        NEW.cashier_id := v_uid;
      ELSIF NEW.cashier_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF NOT public.user_may_access_branch(OLD.branch_id) THEN
        RAISE EXCEPTION 'BRANCH_MISMATCH';
      END IF;
      IF OLD.cashier_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;

    IF NOT public.user_may_access_branch(OLD.branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;

    -- Specialized subsystem-only fields are intentionally outside POS ownership.
    -- Their own permission/RPC guards remain authoritative.
    v_owner_mutation :=
      (to_jsonb(NEW) - ARRAY[
        'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station',
        'print_status', 'printed_at', 'updated_at'
      ]::text[])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY[
        'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station',
        'print_status', 'printed_at', 'updated_at'
      ]::text[]);

    IF NEW.cashier_id IS DISTINCT FROM OLD.cashier_id THEN
      v_transfer_context :=
        COALESCE(current_setting('app.pos_operator_transfer_order_id', true), '') = OLD.id::text
        AND COALESCE(current_setting('app.pos_operator_transfer_target_id', true), '') = COALESCE(NEW.cashier_id::text, '')
        AND public.can_permission('pos.order.transfer');

      IF NOT v_transfer_context THEN
        RAISE EXCEPTION 'ORDER_TRANSFER_RPC_REQUIRED';
      END IF;
      IF NOT v_can_manage_others THEN
        RAISE EXCEPTION 'POS_ADMIN_PERMISSION_REQUIRED';
      END IF;

      IF
        (to_jsonb(NEW) - ARRAY[
          'cashier_id', 'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station',
          'print_status', 'printed_at', 'updated_at'
        ]::text[])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY[
          'cashier_id', 'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station',
          'print_status', 'printed_at', 'updated_at'
        ]::text[])
      THEN
        RAISE EXCEPTION 'ORDER_TRANSFER_MUTATION_SCOPE';
      END IF;
      RETURN NEW;
    END IF;

    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;

    IF NEW.table_id IS DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.transfer') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.transfer';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'order_items' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT o.cashier_id, o.branch_id INTO v_owner_id, v_branch_id
      FROM public.orders o WHERE o.id = NEW.order_id;
      IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
      IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
      IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN NEW;
    END IF;

    SELECT o.cashier_id, o.branch_id INTO v_owner_id, v_branch_id
    FROM public.orders o WHERE o.id = OLD.order_id;
    IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN RAISE EXCEPTION 'BRANCH_MISMATCH'; END IF;
    IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      SELECT o.cashier_id, o.branch_id INTO v_new_owner_id, v_new_branch_id
      FROM public.orders o WHERE o.id = NEW.order_id;
      IF v_new_branch_id IS NULL THEN RAISE EXCEPTION 'TARGET_ORDER_NOT_FOUND'; END IF;
      IF v_new_branch_id IS DISTINCT FROM v_branch_id THEN RAISE EXCEPTION 'CROSS_BRANCH_ORDER_ITEM_MOVE'; END IF;
      IF v_new_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'TARGET_ORDER_OPERATOR_REQUIRED';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'dining_tables' THEN
    IF TG_OP = 'DELETE' THEN
      IF NOT v_can_manage_others AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.table_id = OLD.id AND o.status IN ('open','held')
          AND o.cashier_id IS DISTINCT FROM v_uid
      ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF NOT v_can_manage_others AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.table_id = OLD.id AND o.status IN ('open','held')
          AND o.cashier_id IS DISTINCT FROM v_uid
      ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_pos_operator_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_pos_operator_ownership() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_pos_operator_ownership() TO service_role;

-- KDS users may pass row-level UPDATE policy only with the explicit KDS write
-- permission. The trigger above still prevents them mutating non-KDS POS fields.
DROP POLICY IF EXISTS auth_update_orders ON public.orders;
CREATE POLICY auth_update_orders ON public.orders
FOR UPDATE TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND (
    cashier_id = auth.uid()
    OR public.can_manage_other_pos_orders()
    OR public.can_permission('pos.kds_update')
  )
)
WITH CHECK (
  public.user_may_access_branch(branch_id)
  AND (
    cashier_id = auth.uid()
    OR public.can_manage_other_pos_orders()
    OR public.can_permission('pos.kds_update')
  )
);

CREATE OR REPLACE FUNCTION public.transfer_order_operator(
  p_order_id uuid,
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_executor_id uuid := auth.uid();
  v_source_ok boolean := false;
  v_target_ok boolean := false;
  v_table_ok boolean := true;
BEGIN
  IF v_executor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.transfer');
  END IF;
  IF NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS_ADMIN_PERMISSION_REQUIRED');
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF v_order.status NOT IN ('open','held') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;

  IF v_order.cashier_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = v_order.cashier_id
        AND u.is_active = true
        AND (
          u.branch_id = v_order.branch_id
          OR EXISTS (
            SELECT 1 FROM public.user_branch_access uba
            WHERE uba.user_id = u.id AND uba.branch_id = v_order.branch_id
          )
        )
    ) INTO v_source_ok;
    IF NOT v_source_ok THEN
      RETURN jsonb_build_object('success', false, 'error', 'SOURCE_OPERATOR_NOT_IN_BRANCH');
    END IF;
  END IF;

  IF v_order.cashier_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_OPERATOR');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_target_user_id
      AND u.is_active = true
      AND (
        u.branch_id = v_order.branch_id
        OR EXISTS (
          SELECT 1 FROM public.user_branch_access uba
          WHERE uba.user_id = u.id AND uba.branch_id = v_order.branch_id
        )
      )
  ) INTO v_target_ok;
  IF NOT v_target_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_USER_NOT_IN_BRANCH');
  END IF;

  IF v_order.table_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.dining_tables t
      WHERE t.id = v_order.table_id AND t.branch_id = v_order.branch_id
    ) INTO v_table_ok;
    IF NOT v_table_ok THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_BRANCH_MISMATCH');
    END IF;
  END IF;

  PERFORM set_config('app.pos_operator_transfer_order_id', v_order.id::text, true);
  PERFORM set_config('app.pos_operator_transfer_target_id', p_target_user_id::text, true);

  UPDATE public.orders
  SET cashier_id = p_target_user_id,
      updated_at = now()
  WHERE id = v_order.id;

  PERFORM set_config('app.pos_operator_transfer_order_id', '', true);
  PERFORM set_config('app.pos_operator_transfer_target_id', '', true);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'branch_id', v_order.branch_id,
    'table_id', v_order.table_id,
    'from_cashier_id', v_order.cashier_id,
    'to_cashier_id', p_target_user_id,
    'transferred_by', v_executor_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_order_operator(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_order_operator(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_operator(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_to_kitchen(
  p_order_id uuid,
  p_sent_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
BEGIN
  IF v_is_service_role THEN
    RETURN public._send_to_kitchen_core_20260914(p_order_id, p_sent_by);
  END IF;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.send_kitchen') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.send_kitchen');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_order.status NOT IN ('open','held') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
  END IF;
  IF v_order.cashier_id IS DISTINCT FROM v_uid
     AND NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_OPERATOR_REQUIRED');
  END IF;

  RETURN public._send_to_kitchen_core_20260914(p_order_id, p_sent_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO authenticated, service_role;
