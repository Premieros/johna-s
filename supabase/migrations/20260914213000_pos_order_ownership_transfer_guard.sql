-- Permission-first POS order ownership hardening.
--
-- Scope only:
--   * order/table ownership and administrative override by explicit permissions
--   * controlled operator reassignment
--   * guarded workspace access
--   * guarded kitchen-send entry point
--   * direct Data API write/read hardening for order ownership
--
-- Explicitly NOT changed here:
--   * sale pricing/payment calculations
--   * send_to_kitchen inventory/KDS implementation
--   * printing / print-agent / printer routing / print queues
--
-- Super Admin keeps the existing implicit bypass through can_permission().
-- Every other administrative override is permission-derived; no role name is used.

CREATE OR REPLACE FUNCTION public.can_manage_other_pos_orders()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.can_permission('pos.view')
    AND public.can_permission('pos.order.edit')
    AND public.can_permission('users.manage');
$function$;

REVOKE ALL ON FUNCTION public.can_manage_other_pos_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_manage_other_pos_orders() FROM anon;
GRANT EXECUTE ON FUNCTION public.can_manage_other_pos_orders() TO authenticated, service_role;

-- Keep the existing ownership trigger contract, but allow an explicit
-- permission-derived administrative override. No ordinary role label is used.
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

  -- Existing Super Admin implicit bypass only.
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

      -- New orders remain self-owned. Administrative reassignment must use the
      -- audited transfer_order_operator() RPC after creation.
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

    -- KDS-only fields stay outside POS ownership, exactly as before.
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

      IF NOT v_can_manage_others THEN
        RAISE EXCEPTION 'POS_ADMIN_PERMISSION_REQUIRED';
      END IF;

      -- Reassignment changes cashier_id (+ updated_at) only.
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
      IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
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
    IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
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
      IF v_new_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others THEN
        RAISE EXCEPTION 'TARGET_ORDER_OPERATOR_REQUIRED';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'dining_tables' THEN
    IF TG_OP = 'DELETE' THEN
      IF NOT v_can_manage_others AND EXISTS (
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

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF NOT v_can_manage_others AND EXISTS (
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

REVOKE ALL ON FUNCTION public.guard_pos_operator_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_pos_operator_ownership() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_pos_operator_ownership() TO service_role;

-- Explicit access gate for /pos/:orderId. Visibility of occupied-table metadata
-- stays branch-scoped, but opening the operational workspace is owner/admin only.
CREATE OR REPLACE FUNCTION public.authorize_pos_order_access(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.view');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND status IN ('open', 'held');

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
  END IF;
  IF v_order.cashier_id IS DISTINCT FROM auth.uid()
     AND NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_OPERATOR_REQUIRED',
      'cashier_id', v_order.cashier_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'branch_id', v_order.branch_id,
    'cashier_id', v_order.cashier_id,
    'managed_other', v_order.cashier_id IS DISTINCT FROM auth.uid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.authorize_pos_order_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authorize_pos_order_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.authorize_pos_order_access(uuid) TO authenticated, service_role;

-- Managers can resume another user's occupied table only through the same
-- permission-derived administrative capability.
CREATE OR REPLACE FUNCTION public.resolve_my_active_table_order(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branch_id uuid;
  v_order_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.view') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED:pos.view');
  END IF;

  SELECT t.branch_id INTO v_branch_id
  FROM public.dining_tables t
  WHERE t.id = p_table_id AND t.is_active = true;

  IF v_branch_id IS NULL OR NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_FOUND');
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.table_id = p_table_id
    AND o.branch_id = v_branch_id
    AND o.status IN ('open', 'held')
    AND (
      o.cashier_id = v_uid
      OR public.can_manage_other_pos_orders()
    )
  ORDER BY (o.cashier_id = v_uid) DESC, o.created_at DESC, o.id DESC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'TABLE_BUSY', 'resumable', false);
  END IF;

  RETURN jsonb_build_object('success', true, 'resumable', true, 'order_id', v_order_id);
END;
$function$;

-- Reassignment is administrative: transfer + edit + users.manage (and pos.view
-- through can_manage_other_pos_orders). No role-name authorization.
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
BEGIN
  IF v_executor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT public.can_manage_other_pos_orders() THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS_ADMIN_PERMISSION_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.order.transfer') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.transfer');
  END IF;

  SELECT * INTO v_order
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
  IF v_order.cashier_id = p_target_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAME_OPERATOR');
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
  ) INTO v_target_ok;

  IF NOT v_target_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'TARGET_USER_NOT_IN_BRANCH');
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

-- set_order_status used to allow only owner or Super Admin. Extend the same
-- operation to permission-derived POS administrators while preserving all
-- existing hold/cancel/payment and sent-item safeguards.
CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;
  IF p_status NOT IN ('open','held','completed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

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
  IF v_order.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_CLOSED');
  END IF;
  IF p_status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'COMPLETION_REQUIRES_PAYMENT',
      'detail', 'Complete the order through the controlled payment flow.'
    );
  END IF;

  IF p_status = 'cancelled' THEN
    IF NOT public.can_permission('pos.cancel_order') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.cancel_order');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.order_kitchen_sends oks
      JOIN public.order_items oi ON oi.id = oks.order_item_id
      WHERE oi.order_id = p_order_id
        AND COALESCE(oks.sent_quantity,0) > 0
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID',
        'detail', 'Cancel sent items through the audited void flow before cancelling the order.'
      );
    END IF;
    IF p_notes IS NULL OR length(trim(p_notes)) < 3 THEN
      RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
    END IF;
  ELSE
    IF NOT public.can_permission('pos.hold') THEN
      RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.hold');
    END IF;
  END IF;

  UPDATE public.orders
  SET status = p_status,
      updated_at = now(),
      completed_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE NULL END,
      notes = COALESCE(NULLIF(trim(p_notes),''), notes)
  WHERE id = p_order_id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.dining_tables
    SET status = CASE WHEN p_status = 'cancelled' THEN 'vacant' ELSE 'occupied' END,
        updated_at = now()
    WHERE id = v_order.table_id;
  END IF;

  INSERT INTO public.audit_log(user_id, action, entity, entity_id, details, branch_id)
  VALUES (
    v_uid,
    CASE WHEN p_status = 'cancelled' THEN 'ORDER_CANCELLED' ELSE 'ORDER_STATUS_CHANGED' END,
    'order',
    p_order_id,
    jsonb_build_object('from_status',v_order.status,'to_status',p_status,'reason',p_notes),
    v_order.branch_id
  );

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', p_status);
END;
$function$;

-- Direct Data API writes must obey the same ownership/admin rule. SELECT on
-- orders intentionally remains branch-visible so the floor plan can show that a
-- table is occupied and display its operator. Full workspace opening is gated by
-- authorize_pos_order_access().
DROP POLICY IF EXISTS auth_update_orders ON public.orders;
CREATE POLICY auth_update_orders ON public.orders
FOR UPDATE TO authenticated
USING (
  public.user_may_access_branch(branch_id)
  AND (cashier_id = auth.uid() OR public.can_manage_other_pos_orders())
)
WITH CHECK (
  public.user_may_access_branch(branch_id)
  AND (cashier_id = auth.uid() OR public.can_manage_other_pos_orders())
);

DROP POLICY IF EXISTS auth_insert_order_items ON public.order_items;
CREATE POLICY auth_insert_order_items ON public.order_items
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND public.user_may_access_branch(o.branch_id)
      AND (o.cashier_id = auth.uid() OR public.can_manage_other_pos_orders())
  )
);

DROP POLICY IF EXISTS auth_update_order_items ON public.order_items;
CREATE POLICY auth_update_order_items ON public.order_items
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND public.user_may_access_branch(o.branch_id)
      AND (o.cashier_id = auth.uid() OR public.can_manage_other_pos_orders())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND public.user_may_access_branch(o.branch_id)
      AND (o.cashier_id = auth.uid() OR public.can_manage_other_pos_orders())
  )
);

-- Normal POS users must not fetch another operator's line details merely because
-- they share a branch. KDS viewers retain the deliberate cross-order view, and
-- the separate financial_visibility_order_items policy remains untouched.
DROP POLICY IF EXISTS auth_select_order_items ON public.order_items;
CREATE POLICY auth_select_order_items ON public.order_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND public.user_may_access_branch(o.branch_id)
      AND (
        o.cashier_id = auth.uid()
        OR public.can_manage_other_pos_orders()
        OR public.can_permission('pos.kds_view')
      )
  )
);

-- Preserve the exact inventory/KDS implementation of send_to_kitchen by moving
-- it behind an ownership wrapper instead of editing its body.
ALTER FUNCTION public.send_to_kitchen(uuid, uuid)
  RENAME TO _send_to_kitchen_core_20260914;

REVOKE ALL ON FUNCTION public._send_to_kitchen_core_20260914(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._send_to_kitchen_core_20260914(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._send_to_kitchen_core_20260914(uuid, uuid) TO service_role;

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
  WHERE id = p_order_id
    AND status IN ('open', 'held');

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

  -- The core owns inventory deduction, delta semantics and KDS snapshots.
  RETURN public._send_to_kitchen_core_20260914(p_order_id, p_sent_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO authenticated, service_role;
