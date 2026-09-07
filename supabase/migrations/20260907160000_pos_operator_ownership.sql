-- Stage 4.2: POS operator ownership and controlled operator transfer.
--
-- Contract:
--   * A branch shift is shared, but each open/held order has one operational owner.
--   * Normal users may create orders only for auth.uid().
--   * POS mutations are owner-only; KDS-only fields remain independently permissioned.
--   * Changing an order table requires pos.order.transfer.
--   * Changing the operational owner is allowed only through transfer_order_operator().
--   * Same-branch users may resolve the operator display label without users.view.

CREATE OR REPLACE FUNCTION public.guard_pos_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role_setting text := COALESCE(current_setting('role', true), '');
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_is_db_admin boolean :=
    COALESCE(current_setting('role', true), '') IN ('', 'none', 'postgres', 'supabase_admin')
    AND session_user IN ('postgres', 'supabase_admin');
  v_owner_id uuid;
  v_branch_id uuid;
  v_new_owner_id uuid;
  v_new_branch_id uuid;
  v_transfer_context boolean := false;
  v_owner_mutation boolean := false;
BEGIN
  -- Database migrations/seeds and the service role are trusted internal paths.
  -- Authenticated application users are never classified from role-name labels here.
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- The existing canonical helper is intentionally true only for Super Admin.
  IF public.is_pos_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

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
      IF OLD.cashier_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;

    IF NOT public.user_may_access_branch(OLD.branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;

    -- KDS station/status transitions are intentionally outside POS ownership.
    -- They remain protected by enforce_pos_permission_mutation() and their RPCs.
    v_owner_mutation :=
      (to_jsonb(NEW) - ARRAY[
        'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station', 'updated_at'
      ]::text[])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY[
        'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station', 'updated_at'
      ]::text[]);

    IF NEW.cashier_id IS DISTINCT FROM OLD.cashier_id THEN
      v_transfer_context :=
        COALESCE(current_setting('app.pos_operator_transfer_order_id', true), '') = OLD.id::text
        AND COALESCE(current_setting('app.pos_operator_transfer_target_id', true), '') = COALESCE(NEW.cashier_id::text, '')
        AND public.can_permission('pos.order.transfer');

      IF NOT v_transfer_context THEN
        RAISE EXCEPTION 'ORDER_TRANSFER_RPC_REQUIRED';
      END IF;

      -- Operator transfer may change only cashier_id (+ updated_at) in this statement.
      IF
        (to_jsonb(NEW) - ARRAY[
          'cashier_id', 'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station', 'updated_at'
        ]::text[])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY[
          'cashier_id', 'kitchen_status', 'kitchen_sent_at', 'kitchen_ready_at', 'station', 'updated_at'
        ]::text[])
      THEN
        RAISE EXCEPTION 'ORDER_TRANSFER_MUTATION_SCOPE';
      END IF;

      RETURN NEW;
    END IF;

    IF v_owner_mutation AND OLD.cashier_id IS DISTINCT FROM v_uid THEN
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
      SELECT o.cashier_id, o.branch_id
      INTO v_owner_id, v_branch_id
      FROM public.orders o
      WHERE o.id = NEW.order_id;

      IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND';
      END IF;
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RAISE EXCEPTION 'BRANCH_MISMATCH';
      END IF;
      IF v_owner_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN NEW;
    END IF;

    SELECT o.cashier_id, o.branch_id
    INTO v_owner_id, v_branch_id
    FROM public.orders o
    WHERE o.id = OLD.order_id;

    IF v_branch_id IS NULL THEN
      RAISE EXCEPTION 'ORDER_NOT_FOUND';
    END IF;
    IF NOT public.user_may_access_branch(v_branch_id) THEN
      RAISE EXCEPTION 'BRANCH_MISMATCH';
    END IF;
    IF v_owner_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      SELECT o.cashier_id, o.branch_id
      INTO v_new_owner_id, v_new_branch_id
      FROM public.orders o
      WHERE o.id = NEW.order_id;

      IF v_new_branch_id IS NULL THEN
        RAISE EXCEPTION 'TARGET_ORDER_NOT_FOUND';
      END IF;
      IF v_new_branch_id IS DISTINCT FROM v_branch_id THEN
        RAISE EXCEPTION 'CROSS_BRANCH_ORDER_ITEM_MOVE';
      END IF;
      IF v_new_owner_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'TARGET_ORDER_OPERATOR_REQUIRED';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'dining_tables' THEN
    IF TG_OP = 'DELETE' THEN
      IF EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.table_id = OLD.id
          AND o.status IN ('open', 'held')
          AND o.cashier_id IS DISTINCT FROM v_uid
      ) THEN
        RAISE EXCEPTION 'TABLE_OPERATOR_REQUIRED';
      END IF;
      RETURN OLD;
    END IF;

    -- Layout/name administration is not order operation. Ownership applies when
    -- the operational table state/scope itself is being changed.
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.table_id = OLD.id
          AND o.status IN ('open', 'held')
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

DROP TRIGGER IF EXISTS trg_pos_operator_orders ON public.orders;
CREATE TRIGGER trg_pos_operator_orders
BEFORE INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_pos_operator_ownership();

DROP TRIGGER IF EXISTS trg_pos_operator_order_items ON public.order_items;
CREATE TRIGGER trg_pos_operator_order_items
BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_pos_operator_ownership();

DROP TRIGGER IF EXISTS trg_pos_operator_tables ON public.dining_tables;
CREATE TRIGGER trg_pos_operator_tables
BEFORE UPDATE OR DELETE ON public.dining_tables
FOR EACH ROW
EXECUTE FUNCTION public.guard_pos_operator_ownership();

REVOKE ALL ON FUNCTION public.guard_pos_operator_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_pos_operator_ownership() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_pos_operator_ownership() TO service_role;

-- Cashier reassignment is no longer a generic manager/user-management action.
-- It is an independent POS transfer capability and only the dedicated RPC can
-- establish the transaction-local transfer context consumed by this trigger.
CREATE OR REPLACE FUNCTION public.guard_order_cashier_assignment()
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
  v_target_ok boolean := false;
  v_transfer_context boolean := false;
  v_transferred_at timestamptz := clock_timestamp();
BEGIN
  IF NEW.cashier_id IS NOT DISTINCT FROM OLD.cashier_id THEN
    RETURN NEW;
  END IF;

  IF v_is_service_role OR v_is_db_admin THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF OLD.status NOT IN ('open', 'held') THEN
    RAISE EXCEPTION 'ORDER_CLOSED';
  END IF;
  IF NOT public.user_may_access_branch(OLD.branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  v_transfer_context :=
    COALESCE(current_setting('app.pos_operator_transfer_order_id', true), '') = OLD.id::text
    AND COALESCE(current_setting('app.pos_operator_transfer_target_id', true), '') = COALESCE(NEW.cashier_id::text, '');

  IF NOT v_transfer_context THEN
    RAISE EXCEPTION 'ORDER_TRANSFER_RPC_REQUIRED';
  END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.transfer';
  END IF;
  IF NEW.cashier_id IS NULL THEN
    RAISE EXCEPTION 'CASHIER_REQUIRED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = NEW.cashier_id
      AND u.is_active = true
      AND (
        u.branch_id = OLD.branch_id
        OR EXISTS (
          SELECT 1
          FROM public.user_branch_access uba
          WHERE uba.user_id = u.id
            AND uba.branch_id = OLD.branch_id
        )
      )
  )
  INTO v_target_ok;

  IF NOT v_target_ok THEN
    RAISE EXCEPTION 'TARGET_USER_NOT_IN_BRANCH';
  END IF;

  INSERT INTO public.audit_log(user_id, user_email, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    (SELECT u.email FROM public.users u WHERE u.id = v_uid),
    'ORDER_OPERATOR_TRANSFERRED',
    'order',
    OLD.id,
    jsonb_build_object(
      'order_number', OLD.order_number,
      'table_id', OLD.table_id,
      'from_cashier_id', OLD.cashier_id,
      'to_cashier_id', NEW.cashier_id,
      'transferred_by', v_uid,
      'transferred_at', v_transferred_at
    ),
    OLD.branch_id
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_order_cashier_assignment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_order_cashier_assignment() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_order_cashier_assignment() TO service_role;

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
  v_target_ok boolean := false;
  v_source_ok boolean := false;
BEGIN
  IF v_executor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = v_executor_id AND u.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.transfer');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.status IN ('open', 'held')
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_order.cashier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_OPERATOR_REQUIRED');
  END IF;
  IF v_order.cashier_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_OPERATOR');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = v_order.cashier_id
      AND (
        u.branch_id = v_order.branch_id
        OR EXISTS (
          SELECT 1 FROM public.user_branch_access uba
          WHERE uba.user_id = u.id AND uba.branch_id = v_order.branch_id
        )
      )
  )
  INTO v_source_ok;

  IF NOT v_source_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_OPERATOR_NOT_IN_BRANCH');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_target_user_id
      AND u.is_active = true
      AND (
        u.branch_id = v_order.branch_id
        OR EXISTS (
          SELECT 1 FROM public.user_branch_access uba
          WHERE uba.user_id = u.id AND uba.branch_id = v_order.branch_id
        )
      )
  )
  INTO v_target_ok;

  IF NOT v_target_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_USER_NOT_IN_BRANCH');
  END IF;

  IF v_order.table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.dining_tables t
    WHERE t.id = v_order.table_id
      AND t.branch_id = v_order.branch_id
      AND t.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_BRANCH_MISMATCH');
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

-- A POS user needs the operator's display label for occupied tables, but this
-- must not broaden SELECT on public.users or reveal user-management columns.
CREATE OR REPLACE FUNCTION public.get_pos_order_operator_labels(p_branch_id uuid)
RETURNS TABLE(order_id uuid, cashier_id uuid, operator_name text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_service_role boolean :=
    COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
BEGIN
  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN
      RETURN;
    END IF;
    IF NOT public.user_may_access_branch(p_branch_id) OR NOT public.can_permission('pos.view') THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.cashier_id,
    COALESCE(NULLIF(trim(u.full_name), ''), NULLIF(trim(u.username), ''), u.email, '—')
  FROM public.orders o
  LEFT JOIN public.users u ON u.id = o.cashier_id
  WHERE o.branch_id = p_branch_id
    AND o.status IN ('open', 'held');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_order_operator_labels(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_order_operator_labels(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_operator_labels(uuid) TO authenticated, service_role;
