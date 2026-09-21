BEGIN;

-- Action-specific POS authorization for another operator's order.
--
-- Safety contract:
--   * branch access / RLS stays authoritative;
--   * each explicit permission authorizes only its own operation;
--   * no role-name authorization;
--   * no broad users.manage/edit/transfer grant is inferred;
--   * order ownership / sale attribution is preserved;
--   * print payloads, print-agent behavior, printer routes and station routing
--     are not changed by this migration.
--
-- This migration is prepared for verification only. Do not apply to Production
-- before Full Verify is green and explicit approval is given.

CREATE OR REPLACE FUNCTION public._pos_action_context_matches(
  p_order_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(current_setting('app.pos_action_authorized', true), '') = '1'
    AND COALESCE(current_setting('app.pos_action_actor_id', true), '') = auth.uid()::text
    AND COALESCE(current_setting('app.pos_action_order_id', true), '') = p_order_id::text
    AND COALESCE(current_setting('app.pos_action_permission', true), '') = p_permission
    AND public.can_permission(p_permission)
    AND EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = p_order_id
        AND o.status IN ('open','held')
        AND public.user_may_access_branch(o.branch_id)
    );
$function$;

REVOKE ALL ON FUNCTION public._pos_action_context_matches(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pos_action_context_matches(uuid,text)
  TO service_role, postgres;

COMMENT ON FUNCTION public._pos_action_context_matches(uuid,text) IS
  'Internal trigger-only proof that a controlled POS RPC authorized the exact actor/order/permission action in the current transaction.';

-- Opening the operational workspace is view + branch access. Mutation remains
-- protected independently by the exact action RPC / trigger permission.
CREATE OR REPLACE FUNCTION public.authorize_pos_order_access(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.view') THEN
    RETURN jsonb_build_object(
      'success',false,'error','PERMISSION_DENIED','permission','pos.view'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id=p_order_id
    AND status IN ('open','held');

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'order_id',v_order.id,
    'branch_id',v_order.branch_id,
    'cashier_id',v_order.cashier_id,
    'managed_other',v_order.cashier_id IS DISTINCT FROM auth.uid()
  );
END;
$function$;

-- A user with POS view may resume/view a same-branch active table order. Exact
-- actions inside the workspace remain permission-gated.
CREATE OR REPLACE FUNCTION public.resolve_my_active_table_order(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_branch_id uuid;
  v_order_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.view') THEN
    RETURN jsonb_build_object(
      'success',false,'error','PERMISSION_DENIED','permission','pos.view'
    );
  END IF;

  SELECT t.branch_id INTO v_branch_id
  FROM public.dining_tables t
  WHERE t.id=p_table_id
    AND t.is_active=true;

  IF v_branch_id IS NULL
     OR NOT public.user_may_access_branch(v_branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','TABLE_NOT_FOUND');
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.table_id=p_table_id
    AND o.branch_id=v_branch_id
    AND o.status IN ('open','held')
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id=o.id
        AND oi.quantity>0
    )
  ORDER BY (o.cashier_id=v_uid) DESC,o.created_at DESC,o.id DESC
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,'error','TABLE_BUSY','resumable',false
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,'resumable',true,'order_id',v_order_id
  );
END;
$function$;

-- Settlement preview belongs to payment/receipt capabilities and must not
-- silently require the broad manage-other bundle.
CREATE OR REPLACE FUNCTION public.get_order_settlement_preview(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.payment.take')
     AND NOT public.can_permission('pos.receipt.print') THEN
    RETURN jsonb_build_object(
      'success',false,'error','PERMISSION_DENIED',
      'permission','pos.payment.take|pos.receipt.print'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id=p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;

  RETURN public._build_order_settlement_preview(p_order_id);
END;
$function$;

-- Receipt permission authorizes only queueing the existing open-order receipt.
-- Existing queue kind/station/payload/idempotency behavior remains unchanged.
CREATE OR REPLACE FUNCTION public.enqueue_cloud_open_order_print(
  p_order_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
  v_job public.cloud_print_jobs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.receipt.print') THEN
    RETURN jsonb_build_object(
      'success',false,'error','PERMISSION_DENIED',
      'permission','pos.receipt.print'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id=p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF v_order.status NOT IN ('open','held') THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD');
  END IF;
  IF COALESCE(btrim(p_idempotency_key),'')='' THEN
    RETURN jsonb_build_object(
      'success',false,'error','IDEMPOTENCY_KEY_REQUIRED'
    );
  END IF;

  INSERT INTO public.cloud_print_jobs(
    branch_id,requested_by,kind,station_code,payload,idempotency_key
  ) VALUES (
    v_order.branch_id,v_uid,'receipt','cashier',
    p_payload,btrim(p_idempotency_key)
  )
  ON CONFLICT (branch_id,idempotency_key) DO UPDATE
  SET updated_at=public.cloud_print_jobs.updated_at
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'success',true,
    'job_id',v_job.id,
    'status',v_job.status,
    'station_code','cashier'
  );
END;
$function$;

-- Kitchen permission authorizes the kitchen action itself on an accessible
-- branch order. The existing core keeps inventory/KDS/routing semantics.
CREATE OR REPLACE FUNCTION public.send_to_kitchen(
  p_order_id uuid,
  p_sent_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
  v_is_service_role boolean:=
    COALESCE(current_setting('role',true),'')='service_role';
BEGIN
  IF v_is_service_role THEN
    RETURN public._send_to_kitchen_core_20260914(p_order_id,p_sent_by);
  END IF;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT public.can_permission('pos.send_kitchen') THEN
    RETURN jsonb_build_object(
      'success',false,'error','PERMISSION_DENIED',
      'permission','pos.send_kitchen'
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id=p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF v_order.status NOT IN ('open','held') THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE');
  END IF;

  IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
    PERFORM set_config('app.pos_action_authorized','1',true);
    PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
    PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
    PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);
  END IF;

  RETURN public._send_to_kitchen_core_20260914(p_order_id,p_sent_by);
END;
$function$;

-- Cancel permission authorizes cancellation only. Hold/open state changes on
-- another operator's order continue to require the existing manage-other
-- capability.
CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=v_uid AND is_active=true
  ) THEN
    RETURN jsonb_build_object('success',false,'error','USER_NOT_FOUND');
  END IF;
  IF p_status NOT IN ('open','held','completed','cancelled') THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_STATUS');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id=p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF v_order.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_CLOSED');
  END IF;
  IF p_status='completed' THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','COMPLETION_REQUIRES_PAYMENT',
      'detail','Complete the order through the controlled payment flow.'
    );
  END IF;

  IF p_status='cancelled' THEN
    IF NOT public.can_permission('pos.cancel_order') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED',
        'permission','pos.cancel_order'
      );
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.order_kitchen_sends oks
      JOIN public.order_items oi ON oi.id=oks.order_item_id
      WHERE oi.order_id=p_order_id
        AND COALESCE(oks.sent_quantity,0)>0
    ) THEN
      RETURN jsonb_build_object(
        'success',false,
        'error','SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID',
        'detail','Cancel sent items through the audited void flow before cancelling the order.'
      );
    END IF;
    IF p_notes IS NULL OR length(trim(p_notes))<3 THEN
      RETURN jsonb_build_object('success',false,'error','REASON_REQUIRED');
    END IF;

    IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.cancel_order',true);
    END IF;
  ELSE
    IF v_order.cashier_id IS DISTINCT FROM v_uid
       AND NOT public.can_manage_other_pos_orders() THEN
      RETURN jsonb_build_object(
        'success',false,'error','ORDER_OPERATOR_REQUIRED'
      );
    END IF;
    IF NOT public.can_permission('pos.hold') THEN
      RETURN jsonb_build_object(
        'success',false,'error','PERMISSION_DENIED',
        'permission','pos.hold'
      );
    END IF;
  END IF;

  UPDATE public.orders
  SET status=p_status,
      updated_at=now(),
      completed_at=CASE WHEN p_status='cancelled' THEN now() ELSE NULL END,
      notes=COALESCE(NULLIF(trim(p_notes),''),notes)
  WHERE id=p_order_id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.dining_tables
    SET status=CASE WHEN p_status='cancelled' THEN 'vacant' ELSE 'occupied' END,
        updated_at=now()
    WHERE id=v_order.table_id;
  END IF;

  INSERT INTO public.audit_log(
    user_id,action,entity,entity_id,details,branch_id
  ) VALUES (
    v_uid,
    CASE WHEN p_status='cancelled'
      THEN 'ORDER_CANCELLED'
      ELSE 'ORDER_STATUS_CHANGED'
    END,
    'order',
    p_order_id,
    jsonb_build_object(
      'from_status',v_order.status,
      'to_status',p_status,
      'reason',p_notes
    ),
    v_order.branch_id
  );

  RETURN jsonb_build_object(
    'success',true,'order_id',p_order_id,'status',p_status
  );
END;
$function$;

-- Allow exact action contexts through the generic order ownership trigger.
-- Generic edit/delete/item mutation keeps the existing owner/admin contract.
DO $patch_order_owner_action_context$
DECLARE
  v_sig regprocedure:=
    to_regprocedure('public.guard_pos_operator_ownership()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'guard_pos_operator_ownership target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('v_pos_action_context boolean:=false;' in v_def)=0 THEN
    v_next:=replace(
      v_def,
      $old$  v_sent_item_void_context boolean:=false;$old$,
      $new$  v_sent_item_void_context boolean:=false;
  v_pos_action_context boolean:=false;$new$
    );

    v_next:=replace(
      v_next,
      $old$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_order_item_transfer_context
       AND NOT v_sent_item_void_context THEN$old$,
      $new$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    v_pos_action_context :=
      public._pos_action_context_matches(OLD.id,'pos.payment.take')
      OR public._pos_action_context_matches(OLD.id,'pos.send_kitchen')
      OR public._pos_action_context_matches(OLD.id,'pos.cancel_order');

    IF v_owner_mutation
       AND OLD.cashier_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_order_item_transfer_context
       AND NOT v_sent_item_void_context
       AND NOT v_pos_action_context THEN$new$
    );

    IF v_next=v_def
       OR position('v_pos_action_context boolean:=false;' in v_next)=0
       OR position('_pos_action_context_matches(OLD.id,''pos.payment.take'')' in v_next)=0 THEN
      RAISE EXCEPTION
        'guard_pos_operator_ownership action-context patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_order_owner_action_context$;

-- The permission trigger is separate from the ownership trigger. Allow the
-- same exact action proof through order bookkeeping fields without granting
-- pos.order.edit. This is required for first kitchen send warehouse binding and
-- for payment-only settlement bookkeeping.
DO $patch_permission_guard_action_context$
DECLARE
  v_sig regprocedure:=
    to_regprocedure('public.enforce_pos_permission_mutation()');
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'enforce_pos_permission_mutation target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('v_pos_action_context boolean := false;' in v_def)=0 THEN
    v_next:=replace(
      v_def,
      $old$  v_sent_item_void_context boolean := false;$old$,
      $new$  v_sent_item_void_context boolean := false;
  v_pos_action_context boolean := false;$new$
    );

    v_next:=replace(
      v_next,
      $old$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context THEN$old$,
      $new$    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    v_pos_action_context :=
      public._pos_action_context_matches(OLD.id,'pos.payment.take')
      OR public._pos_action_context_matches(OLD.id,'pos.send_kitchen')
      OR public._pos_action_context_matches(OLD.id,'pos.cancel_order');

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context
       AND NOT v_pos_action_context THEN$new$
    );

    IF v_next=v_def
       OR position('v_pos_action_context boolean := false;' in v_next)=0
       OR position('_pos_action_context_matches(OLD.id,''pos.send_kitchen'')' in v_next)=0 THEN
      RAISE EXCEPTION
        'enforce_pos_permission_mutation action-context patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_permission_guard_action_context$;

-- Preserve transfer and controlled Void exceptions while allowing only the
-- exact send-kitchen context through the kitchen-send ownership trigger.
CREATE OR REPLACE FUNCTION public.guard_kitchen_send_operator_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_is_service_role boolean:=
    COALESCE(current_setting('role',true),'')='service_role'
    OR COALESCE(current_setting('request.jwt.claim.role',true),'')='service_role';
  v_is_db_admin boolean:=
    COALESCE(current_setting('role',true),'') IN ('','none','postgres','supabase_admin')
    AND session_user IN ('postgres','supabase_admin');
  v_order_id uuid;
  v_owner_id uuid;
  v_branch_id uuid;
  v_item_transfer_context boolean:=false;
  v_cross_operator_void_authorized boolean:=false;
  v_send_action_authorized boolean:=false;
BEGIN
  IF v_is_service_role OR v_is_db_admin THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF public.is_pos_admin() THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    v_item_transfer_context:=
      COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
      AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
      AND COALESCE(current_setting('app.pos_item_transfer_item_ids',true),'') LIKE '%' || OLD.order_item_id::text || '%'
      AND public.can_permission('pos.order.transfer');

    IF v_item_transfer_context THEN
      RETURN NEW;
    END IF;
  END IF;

  v_order_id:=
    CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.cashier_id,o.branch_id
  INTO v_owner_id,v_branch_id
  FROM public.orders o
  WHERE o.id=v_order_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF NOT public.user_may_access_branch(v_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_MISMATCH';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_uid THEN
    v_send_action_authorized:=
      public._pos_action_context_matches(
        v_order_id,'pos.send_kitchen'
      );

    IF v_send_action_authorized THEN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
      END IF;
      RETURN NEW;
    END IF;

    v_cross_operator_void_authorized:=
      public._sent_item_void_context_matches(
        v_order_id,
        CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
      );

    IF NOT v_cross_operator_void_authorized THEN
      RAISE EXCEPTION 'ORDER_OPERATOR_REQUIRED';
    END IF;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- Patch payment wrappers in-place so the current accounting / inventory /
-- settlement implementation stays byte-for-byte unchanged outside the old
-- ownership gate.
DO $patch_process_sale_action_context$
DECLARE
  v_sig regprocedure:=
    to_regprocedure(
      'public.process_sale(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)'
    );
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'process_sale target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('app.pos_action_permission' in v_def)=0 THEN
    v_next:=regexp_replace(
      v_def,
      $re$IF[[:space:]]+v_order_owner[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+auth\.uid\(\)[[:space:]]+AND[[:space:]]+NOT[[:space:]]+public\.can_manage_other_pos_orders\(\)[[:space:]]+THEN[[:space:]]+RETURN[[:space:]]+jsonb_build_object\('success',[[:space:]]*false,[[:space:]]*'error',[[:space:]]*'ORDER_OPERATOR_REQUIRED'\);[[:space:]]+END[[:space:]]+IF;$re$,
      $new$IF v_order_owner IS DISTINCT FROM auth.uid() THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
    END IF;$new$,
      'g'
    );

    IF v_next=v_def
       OR position('app.pos_action_permission' in v_next)=0 THEN
      RAISE EXCEPTION
        'process_sale ownership patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_process_sale_action_context$;

DO $patch_process_sale_split_action_context$
DECLARE
  v_sig regprocedure:=
    to_regprocedure(
      'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'
    );
  v_def text;
  v_next text;
BEGIN
  IF v_sig IS NULL THEN
    RAISE EXCEPTION 'process_sale_split target not found';
  END IF;

  SELECT pg_get_functiondef(v_sig) INTO v_def;

  IF position('app.pos_action_permission' in v_def)=0 THEN
    v_next:=regexp_replace(
      v_def,
      $re$IF[[:space:]]+v_order_owner[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+auth\.uid\(\)[[:space:]]+AND[[:space:]]+NOT[[:space:]]+public\.can_manage_other_pos_orders\(\)[[:space:]]+THEN[[:space:]]+RETURN[[:space:]]+jsonb_build_object\('success',[[:space:]]*false,[[:space:]]*'error',[[:space:]]*'ORDER_OPERATOR_REQUIRED'\);[[:space:]]+END[[:space:]]+IF;$re$,
      $new$IF v_order_owner IS DISTINCT FROM auth.uid() THEN
        PERFORM set_config('app.pos_action_authorized','1',true);
        PERFORM set_config('app.pos_action_actor_id',auth.uid()::text,true);
        PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
        PERFORM set_config('app.pos_action_permission','pos.payment.take',true);
      END IF;$new$,
      'g'
    );

    IF v_next=v_def
       OR position('app.pos_action_permission' in v_next)=0 THEN
      RAISE EXCEPTION
        'process_sale_split ownership patch drift; refusing migration';
    END IF;

    EXECUTE v_next;
  END IF;
END;
$patch_process_sale_split_action_context$;

-- Keep RPC exposure exactly as before.
REVOKE ALL ON FUNCTION public.authorize_pos_order_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authorize_pos_order_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.authorize_pos_order_access(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_my_active_table_order(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_my_active_table_order(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_my_active_table_order(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_order_settlement_preview(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_order_settlement_preview(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_order_settlement_preview(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enqueue_cloud_open_order_print(uuid,jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_cloud_open_order_print(uuid,jsonb,text)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.enqueue_cloud_open_order_print(uuid,jsonb,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.send_to_kitchen(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_to_kitchen(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid,uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_order_status(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_order_status(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid,text,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_kitchen_send_operator_ownership()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_kitchen_send_operator_ownership()
  TO service_role;

NOTIFY pgrst,'reload schema';

COMMIT;
