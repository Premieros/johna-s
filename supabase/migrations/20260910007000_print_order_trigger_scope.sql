-- Final handover: keep print-status mutation independent from POS order ownership/editing.
--
-- Exact print-only changes are not operational order edits, so they must not require
-- the current order operator or pos.order.edit. They remain fail-closed behind the
-- dedicated pos.receipt.print capability and the existing branch/RLS boundaries.
-- Every other order mutation keeps the existing permission/ownership behavior.

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
  v_owner_id uuid;
  v_branch_id uuid;
  v_new_owner_id uuid;
  v_new_branch_id uuid;
  v_transfer_context boolean := false;
  v_owner_mutation boolean := false;
  v_print_only_mutation boolean := false;
BEGIN
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Super Admin is the only implicit application bypass.
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

    v_print_only_mutation :=
      (NEW.print_status IS DISTINCT FROM OLD.print_status
       OR NEW.printed_at IS DISTINCT FROM OLD.printed_at)
      AND (to_jsonb(NEW) - ARRAY['print_status','printed_at','updated_at']::text[])
        = (to_jsonb(OLD) - ARRAY['print_status','printed_at','updated_at']::text[]);

    -- Printing is intentionally independent from order ownership. The canonical
    -- permission trigger still requires pos.receipt.print for this exact scope.
    IF v_print_only_mutation THEN
      RETURN NEW;
    END IF;

    -- KDS station/status transitions are independently permissioned.
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

CREATE OR REPLACE FUNCTION public.enforce_pos_permission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_print_only_mutation boolean := false;
BEGIN
  IF v_is_service_role OR v_uid IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sales' THEN
    IF TG_OP = 'INSERT' AND NOT public.can_permission('pos.payment.take') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'order_kitchen_sends' THEN
    IF NOT public.can_permission('pos.send_kitchen') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_permission('pos.order.create') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF NOT public.can_permission('pos.cancel_order') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
      END IF;
      RETURN OLD;
    END IF;

    v_print_only_mutation :=
      (NEW.print_status IS DISTINCT FROM OLD.print_status
       OR NEW.printed_at IS DISTINCT FROM OLD.printed_at)
      AND (to_jsonb(NEW) - ARRAY['print_status','printed_at','updated_at']::text[])
        = (to_jsonb(OLD) - ARRAY['print_status','printed_at','updated_at']::text[]);

    IF v_print_only_mutation THEN
      IF NOT public.can_permission('pos.receipt.print') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.receipt.print';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.kitchen_status IS DISTINCT FROM OLD.kitchen_status
       AND (to_jsonb(NEW) - ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[])
         = (to_jsonb(OLD) - ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[]) THEN
      IF OLD.kitchen_status = 'pending'
         AND NEW.kitchen_status = 'sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS (SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_id = OLD.id) THEN
        RETURN NEW;
      END IF;
      IF NOT public.can_permission('pos.kds_update') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.station IS DISTINCT FROM OLD.station
       AND (to_jsonb(NEW) - ARRAY['station','updated_at']::text[])
         = (to_jsonb(OLD) - ARRAY['station','updated_at']::text[]) THEN
      IF NOT public.can_permission('pos.kds_update') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'cancelled' AND NOT public.can_permission('pos.cancel_order') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
      ELSIF NEW.status = 'completed' THEN
        IF NOT public.can_permission('pos.payment.take') THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take';
        END IF;
        IF NOT public.can_permission('pos.order.edit')
           AND (to_jsonb(NEW)-ARRAY['status','payment_status','payment_at','updated_at']::text[])
             IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','payment_status','payment_at','updated_at']::text[]) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
        END IF;
      ELSIF NEW.status IN ('open', 'held') AND NOT public.can_permission('pos.hold') THEN
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
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'order_items' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_permission('pos.order.create')
         AND NOT public.can_permission('pos.order.edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      IF NOT public.can_permission('pos.void') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.void';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      IF NOT public.can_permission('pos.order.split') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.split';
      END IF;
    ELSIF NOT public.can_permission('pos.order.edit') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_pos_operator_ownership() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_pos_permission_mutation() SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.guard_pos_operator_ownership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_pos_operator_ownership() TO service_role;
REVOKE ALL ON FUNCTION public.enforce_pos_permission_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_pos_permission_mutation() TO service_role;

COMMENT ON FUNCTION public.enforce_pos_permission_mutation()
IS 'Permission-first POS mutation guard. Exact print-only order changes require pos.receipt.print and do not require pos.order.edit; all other granular POS/KDS permissions remain enforced.';

NOTIFY pgrst, 'reload schema';
