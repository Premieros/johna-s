BEGIN;

-- Make pos.void the dedicated capability for controlled sent-item voids,
-- including an item owned by another operator in the same accessible branch.
-- This does NOT grant generic cross-operator edit/transfer authority.
-- Printing, KDS routing and printer queues are intentionally untouched.

CREATE OR REPLACE FUNCTION public._sent_item_void_context_matches(
  p_order_id uuid,
  p_order_item_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(current_setting('app.approved_sent_item_void', true), '') = '1'
    AND COALESCE(current_setting('app.sent_item_void_authorized', true), '') = '1'
    AND COALESCE(current_setting('app.sent_item_void_actor_id', true), '') = auth.uid()::text
    AND COALESCE(current_setting('app.sent_item_void_order_id', true), '') = p_order_id::text
    AND (
      p_order_item_id IS NULL
      OR COALESCE(current_setting('app.sent_item_void_item_id', true), '') = p_order_item_id::text
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = p_order_id
        AND o.status IN ('open','held')
        AND public.user_may_access_branch(o.branch_id)
    );
$function$;

REVOKE ALL ON FUNCTION public._sent_item_void_context_matches(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sent_item_void_context_matches(uuid,uuid) TO service_role, postgres;

COMMENT ON FUNCTION public._sent_item_void_context_matches(uuid,uuid) IS
  'Internal trigger-only proof that cancel_sent_order_item_exact authorized this exact actor/order/item void in the current transaction.';

DO $patch_exact_void_context$
DECLARE
  v_sig regprocedure := to_regprocedure('public.cancel_sent_order_item_exact(uuid,uuid,numeric,text)');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'cancel_sent_order_item_exact target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('app.sent_item_void_authorized' in v_def) = 0 THEN
    v_next := replace(
      v_def,
      $old$  UPDATE public.order_kitchen_sends$old$,
      $new$  PERFORM set_config('app.approved_sent_item_void', '1', true);
  PERFORM set_config('app.sent_item_void_authorized', '1', true);
  PERFORM set_config('app.sent_item_void_order_id', p_order_id::text, true);
  PERFORM set_config('app.sent_item_void_item_id', v_item.id::text, true);
  PERFORM set_config('app.sent_item_void_actor_id', auth.uid()::text, true);

  UPDATE public.order_kitchen_sends$new$
    );

    IF v_next = v_def
       OR position('app.sent_item_void_authorized' in v_next) = 0 THEN
      RAISE EXCEPTION 'cancel_sent_order_item_exact context patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_exact_void_context$;

DO $patch_kitchen_send_owner_guard$
DECLARE
  v_sig regprocedure := to_regprocedure('public.guard_kitchen_send_operator_ownership()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'guard_kitchen_send_operator_ownership target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('_sent_item_void_context_matches' in v_def) = 0 THEN
    v_next := replace(
      v_def,
      $old$    v_cross_operator_void_authorized :=
      public.can_manage_other_pos_orders()
      AND (public.can_permission('pos.void') OR public.can_permission('approvals.review'));$old$,
      $new$    v_cross_operator_void_authorized :=
      public._sent_item_void_context_matches(
        v_order_id,
        CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
      );$new$
    );

    IF v_next = v_def
       OR position('_sent_item_void_context_matches' in v_next) = 0 THEN
      RAISE EXCEPTION 'guard_kitchen_send_operator_ownership patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_kitchen_send_owner_guard$;

DO $patch_order_owner_guard$
DECLARE
  v_sig regprocedure := to_regprocedure('public.guard_pos_operator_ownership()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'guard_pos_operator_ownership target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('v_sent_item_void_context boolean:=false;' in v_def) = 0 THEN
    v_next := replace(
      v_def,
      $old$  v_owner_mutation boolean:=false;$old$,
      $new$  v_owner_mutation boolean:=false;
  v_sent_item_void_context boolean:=false;$new$
    );

    v_next := replace(
      v_next,
      $old$    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_order_item_transfer_context THEN$old$,
      $new$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_order_item_transfer_context
       AND NOT v_sent_item_void_context THEN$new$
    );

    v_next := replace(
      v_next,
      $old$    IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=$old$,
      $new$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=$new$
    );

    v_next := replace(
      v_next,
      $old$    IF v_owner_id IS DISTINCT FROM v_uid AND NOT v_can_manage_others AND NOT v_item_transfer_context THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;$old$,
      $new$    IF v_owner_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_item_transfer_context
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;$new$
    );

    IF v_next = v_def
       OR position('v_sent_item_void_context boolean:=false;' in v_next) = 0
       OR position('_sent_item_void_context_matches(OLD.id, NULL)' in v_next) = 0
       OR position('_sent_item_void_context_matches(OLD.order_id, OLD.id)' in v_next) = 0 THEN
      RAISE EXCEPTION 'guard_pos_operator_ownership patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_order_owner_guard$;

DO $patch_void_table_reconcile$
DECLARE
  v_sig regprocedure := to_regprocedure('public.guard_pos_operator_ownership()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'guard_pos_operator_ownership target not found for table reconcile patch';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('app.sent_item_void_order_id' in split_part(v_def, $IF TG_TABLE_NAME='dining_tables'$, 2)) = 0 THEN
    v_next := replace(
      v_def,
      $old$      AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
      AND public.can_permission('pos.order.transfer');

    IF TG_OP='DELETE' THEN$old$,
      $new$      AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
      AND public.can_permission('pos.order.transfer');

    v_sent_item_void_context := EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id = OLD.id
        AND COALESCE(current_setting('app.sent_item_void_order_id',true),'') = o.id::text
        AND public._sent_item_void_context_matches(o.id, NULL)
    );

    IF TG_OP='DELETE' THEN$new$
    );

    v_next := replace(
      v_next,
      $old$      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND EXISTS($old$,
      $new$      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND NOT v_sent_item_void_context
         AND EXISTS($new$
    );

    IF v_next = v_def
       OR position('v_sent_item_void_context := EXISTS (' in v_next) = 0
       OR position('AND NOT v_sent_item_void_context' in split_part(v_next, $IF TG_TABLE_NAME='dining_tables'$, 2)) = 0 THEN
      RAISE EXCEPTION 'guard_pos_operator_ownership dining-table Void patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_void_table_reconcile$;

DO $patch_permission_guard$
DECLARE
  v_sig regprocedure := to_regprocedure('public.enforce_pos_permission_mutation()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'enforce_pos_permission_mutation target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('v_sent_item_void_context boolean := false;' in v_def) = 0 THEN
    v_next := replace(
      v_def,
      $old$  v_item_transfer_context boolean := false;$old$,
      $new$  v_item_transfer_context boolean := false;
  v_sent_item_void_context boolean := false;$new$
    );

    v_next := replace(
      v_next,
      $old$  IF TG_TABLE_NAME='order_kitchen_sends' THEN
    IF NOT public.can_permission('pos.send_kitchen') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';
    END IF;$old$,
      $new$  IF TG_TABLE_NAME='order_kitchen_sends' THEN
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(
        CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END,
        CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
      );
    IF NOT public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';
    END IF;$new$
    );

    v_next := replace(
      v_next,
      $old$    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit') THEN$old$,
      $new$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context THEN$new$
    );

    v_next := replace(
      v_next,
      $old$    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.void') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.void'; END IF;
      RETURN OLD;
    END IF;$old$,
      $new$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.void')
         AND NOT v_sent_item_void_context THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.void';
      END IF;
      RETURN OLD;
    END IF;$new$
    );

    v_next := replace(
      v_next,
      $old$    ELSIF NOT public.can_permission('pos.order.edit') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;$old$,
      $new$    ELSIF NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;$new$
    );

    IF v_next = v_def
       OR position('v_sent_item_void_context boolean := false;' in v_next) = 0
       OR position('_sent_item_void_context_matches' in v_next) = 0 THEN
      RAISE EXCEPTION 'enforce_pos_permission_mutation patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_permission_guard$;

NOTIFY pgrst, 'reload schema';

COMMIT;
