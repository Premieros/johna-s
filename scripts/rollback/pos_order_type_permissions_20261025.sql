-- Candidate inverse only: reviewed production approval required.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $undo_0$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type'$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_0'; END IF;
 EXECUTE replace(v_def,v_new,$old$RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen'$old$);
END $undo_0$;

DO $undo_1$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type'$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_1'; END IF;
 EXECUTE replace(v_def,v_new,$old$RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create'$old$);
END $undo_1$;

DO $undo_2$
DECLARE v_def text:=pg_get_functiondef('public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure); v_new text:=$new$'detail', 'pos.order.type'$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_2'; END IF;
 EXECUTE replace(v_def,v_new,$old$'detail', 'pos.send_kitchen'$old$);
END $undo_2$;

DO $undo_3$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_new text:=$new$'permission','pos.order.type'$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_3'; END IF;
 EXECUTE replace(v_def,v_new,$old$'permission','pos.send_kitchen'$old$);
END $undo_3$;

DO $undo_4$
DECLARE v_def text:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure); v_new text:=$new$'permission', 'pos.order.type'$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_4'; END IF;
 EXECUTE replace(v_def,v_new,$old$'permission', 'pos.order.create'$old$);
END $undo_4$;

DO $undo_12$
DECLARE v_def text:=pg_get_functiondef('public._pos_action_context_matches(uuid,text)'::regprocedure); v_new text:=$new$AND CASE WHEN p_permission='pos.send_kitchen' THEN public._pos_existing_order_type_allowed(p_order_id) ELSE public.can_permission(p_permission) END$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_12'; END IF;
 EXECUTE replace(v_def,v_new,$old$AND public.can_permission(p_permission)$old$);
END $undo_12$;

DO $undo_13$
DECLARE v_def text:=pg_get_functiondef('public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure); v_new text:=$new$public._pos_order_type_allowed(v_order_type,v_table_id)$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_13'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.send_kitchen')$old$);
END $undo_13$;

DO $undo_14$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_new text:=$new$public._pos_existing_order_type_allowed(p_order_id)$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_14'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.send_kitchen')$old$);
END $undo_14$;

DO $undo_15$
DECLARE v_def text:=pg_get_functiondef('public.guard_pos_operator_ownership()'::regprocedure); v_new text:=$new$    IF (NEW.order_type IS DISTINCT FROM OLD.order_type OR NEW.table_id IS DISTINCT FROM OLD.table_id)
       AND NOT public._pos_order_type_allowed(NEW.order_type,NEW.table_id) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type';
    END IF;
    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_15'; END IF;
 EXECUTE replace(v_def,v_new,$old$    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN$old$);
END $undo_15$;

DO $undo_16$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$public._pos_order_type_allowed(OLD.order_type,OLD.table_id)$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>2 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_16'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.send_kitchen')$old$);
END $undo_16$;

DO $undo_17$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$public._pos_existing_order_type_allowed(CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END)
       AND NOT v_sent_item_void_context$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_17'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context$old$);
END $undo_17$;

DO $undo_18$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$public._pos_order_type_allowed(OLD.order_type,OLD.table_id)$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_18'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.order.quick_create')
       AND OLD.order_type='takeaway' AND OLD.table_id IS NULL$old$);
END $undo_18$;

DO $undo_19$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$IF NOT public.can_permission('pos.order.edit') AND NOT EXISTS(
        SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id
          AND public._pos_order_type_allowed(qo.order_type,qo.table_id)
          AND qo.cashier_id=auth.uid() AND qo.status='open'
          AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id)
          AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0))
      ) THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_19'; END IF;
 EXECUTE replace(v_def,v_new,$old$IF NOT public.can_permission('pos.order.create') AND NOT public.can_permission('pos.order.edit') AND NOT (public.can_permission('pos.order.quick_create') AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0)) AND EXISTS(SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id AND qo.order_type='takeaway' AND qo.table_id IS NULL AND qo.cashier_id=auth.uid() AND qo.status='open' AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id))) THEN$old$);
END $undo_19$;

DO $undo_20$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$IF NOT public._pos_order_type_allowed(NEW.order_type,NEW.table_id) THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_20'; END IF;
 EXECUTE replace(v_def,v_new,$old$IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(NEW.order_type='takeaway' AND NEW.table_id IS NULL AND NEW.status='open' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission('pos.discount')) AND NEW.cashier_id=auth.uid() AND public.user_may_access_branch(NEW.branch_id),false)) THEN$old$);
END $undo_20$;

DO $undo_21$
DECLARE v_def text:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure); v_new text:=$new$      IF NOT public.can_permission('pos.discount') AND (
        COALESCE(p_discount_amount,0)<>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi
          WHERE COALESCE((qi->>'discount_amount')::numeric,0)<>0 OR COALESCE((qi->>'bonus_quantity')::numeric,0)<>0)
      ) THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.discount'); END IF;
      v_effective_cashier := v_uid;$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_21'; END IF;
 EXECUTE replace(v_def,v_new,$old$      v_effective_cashier := v_uid;$old$);
END $undo_21$;

DO $undo_22$
DECLARE v_def text:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure); v_new text:=$new$IF NOT public._pos_order_type_allowed(p_order_type,p_table_id) THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_22'; END IF;
 EXECUTE replace(v_def,v_new,$old$IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(p_order_type='takeaway' AND p_table_id IS NULL AND (public.can_permission('pos.discount') OR (COALESCE(p_discount_amount,0)=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi WHERE COALESCE((qi->>'discount_amount')::numeric,0)<>0 OR COALESCE((qi->>'bonus_quantity')::numeric,0)<>0))),false)) THEN$old$);
END $undo_22$;

CREATE OR REPLACE FUNCTION public.enqueue_cloud_kitchen_print(p_branch_id uuid, p_station_code text, p_payload jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE v_source_branch uuid; v_source_number text; v_source_matches bigint; v_job public.cloud_print_jobs%ROWTYPE; v_station_code text; BEGIN IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','AUTH_REQUIRED'); END IF; IF p_branch_id IS NULL OR NOT public.user_may_access_branch(p_branch_id) THEN RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH'); END IF; IF NOT public.can_permission('pos.send_kitchen') THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.send_kitchen'); END IF; v_station_code:=lower(btrim(COALESCE(p_station_code,''))); IF v_station_code='' THEN RETURN jsonb_build_object('success',false,'error','STATION_REQUIRED'); END IF; IF v_station_code='cashier' THEN RETURN jsonb_build_object('success',false,'error','CASHIER_RESERVED_FOR_RECEIPTS'); END IF; IF NOT EXISTS(SELECT 1 FROM public.kitchen_stations s WHERE s.branch_id=p_branch_id AND lower(btrim(s.code))=v_station_code AND s.is_active=true) THEN RETURN jsonb_build_object('success',false,'error','STATION_BRANCH_MISMATCH'); END IF; IF COALESCE(btrim(p_idempotency_key),'')='' THEN RETURN jsonb_build_object('success',false,'error','IDEMPOTENCY_KEY_REQUIRED'); END IF; IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN jsonb_build_object('success',false,'error','INVALID_PAYLOAD'); END IF; 
  -- Client-selected branches never override the source order's branch.
  IF NULLIF(p_payload->>'order_id','') IS NOT NULL THEN
    IF (p_payload->>'order_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('success',false,'error','ORDER_PRINT_CONTEXT_INVALID');
    END IF;
    SELECT branch_id INTO v_source_branch FROM public.orders WHERE id=(p_payload->>'order_id')::uuid;
    IF v_source_branch IS NULL THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND'); END IF;
  ELSE
    -- Compatibility for already deployed clients: normal tickets include this
    -- order number. Generic non-order print payloads retain their existing API.
    v_source_number := btrim(substring(p_payload->>'text' FROM '(?:الطلب|طلب|Order|ORDER)[[:space:]]*:[[:space:]]*([^\r\n]+)'));
    IF v_source_number IS NOT NULL THEN
      SELECT count(*),min(branch_id::text)::uuid INTO v_source_matches,v_source_branch
      FROM public.orders WHERE order_number=v_source_number;
      IF v_source_matches<>1 THEN RETURN jsonb_build_object('success',false,'error','ORDER_PRINT_CONTEXT_INVALID'); END IF;
    END IF;
  END IF;
  IF v_source_branch IS NOT NULL AND v_source_branch IS DISTINCT FROM p_branch_id THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_PRINT_BRANCH_MISMATCH');
  END IF;
INSERT INTO public.cloud_print_jobs(branch_id,requested_by,kind,station_code,payload,idempotency_key) VALUES(p_branch_id,auth.uid(),'kitchen',v_station_code,p_payload,btrim(p_idempotency_key)) ON CONFLICT(branch_id,idempotency_key) DO UPDATE SET updated_at=public.cloud_print_jobs.updated_at RETURNING * INTO v_job; RETURN jsonb_build_object('success',true,'job_id',v_job.id,'status',v_job.status); END $function$

CREATE OR REPLACE FUNCTION public._is_branch_captain_order_user(p_user_id uuid, p_branch_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
$function$

DO $restore_roles$
DECLARE v_row jsonb;
BEGIN
 FOR v_row IN SELECT value FROM jsonb_array_elements($roles$[{"role": "000", "before": ["accounting.journal.post", "accounting.reconciliation.manage", "accounting.treasury.transfer", "accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.create", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.send_kitchen", "pos.view", "pos.void", "procurement.order.create", "procurement.payment.create", "procurement.receive", "procurement.request.create", "production.manage", "production.view", "production.waste", "products.create", "products.delete", "products.edit", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"], "after": ["accounting.journal.post", "accounting.reconciliation.manage", "accounting.treasury.transfer", "accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.view", "pos.void", "procurement.order.create", "procurement.payment.create", "procurement.receive", "procurement.request.create", "production.manage", "production.view", "production.waste", "products.create", "products.delete", "products.edit", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"]}, {"role": "34567", "before": ["customers.export", "customers.manage", "customers.print", "customers.view", "pos.kds_view", "pos.order.edit", "pos.order.quick_create", "pos.payment.take", "pos.receipt.print", "pos.view"], "after": ["customers.export", "customers.manage", "customers.print", "customers.view", "pos.kds_view", "pos.order.edit", "pos.order.takeaway", "pos.payment.take", "pos.receipt.print", "pos.view"]}, {"role": "accountant", "before": ["accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.create", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.send_kitchen", "pos.view", "pos.void", "production.manage", "production.view", "production.waste", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "sales.export", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.manage", "shifts.open", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"], "after": ["accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.view", "pos.void", "production.manage", "production.view", "production.waste", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "sales.export", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.manage", "shifts.open", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"]}, {"role": "branch_manager", "before": ["approvals.override", "approvals.review", "categories.view", "components.view", "customers.manage", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.create", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.send_kitchen", "pos.view", "pos.void", "products.modifiers.manage", "products.view", "raw_materials.view", "recipes.view", "refunds.approve", "reports.view", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "users.manage", "users.view", "work.authorization.approve", "work.authorization.bypass"], "after": ["approvals.override", "approvals.review", "categories.view", "components.view", "customers.manage", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.view", "pos.void", "products.modifiers.manage", "products.view", "raw_materials.view", "recipes.view", "refunds.approve", "reports.view", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "users.manage", "users.view", "work.authorization.approve", "work.authorization.bypass"]}, {"role": "cap", "before": ["floor_plan.view", "pos.hold", "pos.kds_update", "pos.order.create", "pos.order.edit", "pos.print_kitchen", "pos.receipt.print", "pos.send_kitchen", "pos.view"], "after": ["floor_plan.view", "pos.hold", "pos.kds_update", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.print_kitchen", "pos.receipt.print", "pos.view"]}, {"role": "cap_cleopatra", "before": ["pos.hold", "pos.order.create", "pos.order.edit", "pos.send_kitchen", "pos.view", "shifts.view"], "after": ["pos.hold", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.view", "shifts.view"]}, {"role": "cashier", "before": ["customers.manage", "customers.print", "customers.view", "pos.kds_view", "pos.order.edit", "pos.order.quick_create", "pos.order.transfer", "pos.payment.take", "pos.receipt.print", "pos.send_kitchen", "pos.view"], "after": ["customers.manage", "customers.print", "customers.view", "pos.kds_view", "pos.order.edit", "pos.order.takeaway", "pos.order.transfer", "pos.payment.take", "pos.receipt.print", "pos.view"]}, {"role": "owner", "before": ["accounting.journal.post", "accounting.reconciliation.manage", "accounting.treasury.transfer", "accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "history.unlimited", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.send_kitchen", "pos.view", "pos.void", "procurement.order.create", "procurement.payment.create", "procurement.receive", "procurement.request.create", "production.manage", "production.view", "production.waste", "products.export", "products.import", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "roles.permissions.manage", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.branches.manage", "users.create", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"], "after": ["accounting.journal.post", "accounting.reconciliation.manage", "accounting.treasury.transfer", "accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "history.unlimited", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.view", "pos.void", "procurement.order.create", "procurement.payment.create", "procurement.receive", "procurement.request.create", "production.manage", "production.view", "production.waste", "products.export", "products.import", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "roles.permissions.manage", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.branches.manage", "users.create", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"]}, {"role": "super_admin", "before": ["approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.create", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.send_kitchen", "pos.view", "pos.void", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.manage", "purchases.print", "purchases.view", "refunds.approve", "reports.export", "reports.print", "reports.view", "sales.export", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.manage", "shifts.open", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "work.authorization.approve", "work.authorization.manage"], "after": ["approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.view", "pos.void", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.manage", "purchases.print", "purchases.view", "refunds.approve", "reports.export", "reports.print", "reports.view", "sales.export", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.manage", "shifts.open", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "work.authorization.approve", "work.authorization.manage"]}, {"role": "مدير_فرع_كليوبترا", "before": ["accounting.journal.post", "accounting.reconciliation.manage", "accounting.treasury.transfer", "accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.create", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.send_kitchen", "pos.view", "pos.void", "procurement.order.create", "procurement.payment.create", "procurement.receive", "procurement.request.create", "production.manage", "production.view", "production.waste", "products.create", "products.delete", "products.edit", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "roles.permissions.manage", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.branches.manage", "users.create", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"], "after": ["accounting.journal.post", "accounting.reconciliation.manage", "accounting.treasury.transfer", "accounts.manage", "accounts.view", "approvals.override", "approvals.policy.manage", "approvals.review", "audit.view", "branches.manage", "categories.manage", "categories.view", "components.manage", "components.view", "customers.export", "customers.manage", "customers.print", "customers.view", "dashboard.view", "expenses.manage", "expenses.print", "expenses.view", "floor_plan.manage", "floor_plan.view", "inventory.adjust", "inventory.count.apply", "inventory.count.approve", "inventory.count.create", "inventory.count.reject", "inventory.ledger.view", "inventory.transfer.approve", "inventory.transfer.create", "inventory.view", "pos.cancel_order", "pos.change_branch", "pos.change_price", "pos.discount", "pos.hold", "pos.kds_update", "pos.kds_view", "pos.order.delivery", "pos.order.dine_in", "pos.order.drive_thru", "pos.order.edit", "pos.order.split", "pos.order.transfer", "pos.payment.take", "pos.print_kitchen", "pos.receipt.print", "pos.reprint", "pos.view", "pos.void", "procurement.order.create", "procurement.payment.create", "procurement.receive", "procurement.request.create", "production.manage", "production.view", "production.waste", "products.create", "products.delete", "products.edit", "products.export", "products.import", "products.modifiers.manage", "products.print", "products.view", "purchases.delete", "purchases.evaluation", "purchases.manage", "purchases.print", "purchases.receiving", "purchases.requests", "purchases.rfq", "purchases.view", "raw_materials.manage", "raw_materials.view", "recipes.manage", "recipes.view", "refunds.approve", "reports.costing", "reports.export", "reports.financial", "reports.print", "reports.view", "roles.permissions.manage", "sales.export", "sales.payment.receive", "sales.print", "sales.refund.create", "sales.view", "settings.manage", "shifts.close", "shifts.close_with_open_orders", "shifts.day_close", "shifts.manage", "shifts.open", "shifts.report.shift", "shifts.report.user", "shifts.view", "suppliers.manage", "suppliers.print", "suppliers.view", "users.branches.manage", "users.create", "users.manage", "users.view", "warehouses.manage", "warehouses.view", "waste.approve", "waste.create", "waste.report", "waste.view", "work.authorization.approve", "work.authorization.bypass", "work.authorization.manage"]}]$roles$::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.roles r WHERE r.role=v_row->>'role'
    AND (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(r.permissions) x)=v_row->'after') THEN
   RAISE EXCEPTION 'POS_TYPE_ROLE_ROLLBACK_DRIFT:%',v_row->>'role';
  END IF;
  UPDATE public.roles SET permissions=v_row->'before' WHERE role=v_row->>'role';
 END LOOP;
END $restore_roles$;
DROP FUNCTION public._pos_existing_order_type_allowed(uuid);
DROP FUNCTION public._pos_order_type_allowed(text,uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
