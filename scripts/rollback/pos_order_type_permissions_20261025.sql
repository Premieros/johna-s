-- Candidate inverse only: reviewed production approval required.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $undo_0$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_new text:=$new$    PERFORM set_config('app.pos_action_authorized','1',true);
    PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
    PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
    PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_0'; END IF;
 EXECUTE replace(v_def,v_new,$old$    IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);
    END IF;$old$);
END $undo_0$;

DO $undo_1$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type';$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_1'; END IF;
 EXECUTE replace(v_def,v_new,$old$AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';$old$);
END $undo_1$;

DO $undo_2$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type'; END IF;$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_2'; END IF;
 EXECUTE replace(v_def,v_new,$old$THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create'; END IF;$old$);
END $undo_2$;

DO $undo_4$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_new text:=$new$'permission','pos.order.type'$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_4'; END IF;
 EXECUTE replace(v_def,v_new,$old$'permission','pos.send_kitchen'$old$);
END $undo_4$;

DO $undo_13$
DECLARE v_def text:=pg_get_functiondef('public._pos_action_context_matches(uuid,text)'::regprocedure); v_new text:=$new$AND CASE WHEN p_permission='pos.send_kitchen' THEN public._pos_existing_order_type_allowed(p_order_id) ELSE public.can_permission(p_permission) END$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_13'; END IF;
 EXECUTE replace(v_def,v_new,$old$AND public.can_permission(p_permission)$old$);
END $undo_13$;

DO $undo_15$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_new text:=$new$public._pos_existing_order_type_allowed(p_order_id)$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_15'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.send_kitchen')$old$);
END $undo_15$;

DO $undo_16$
DECLARE v_def text:=pg_get_functiondef('public.guard_pos_operator_ownership()'::regprocedure); v_new text:=$new$    IF (NEW.table_id IS NOT NULL AND NEW.order_type<>'dine_in')
       OR (NEW.order_type IS DISTINCT FROM OLD.order_type
         AND NOT public._pos_order_type_allowed(NEW.order_type,NEW.table_id)) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type';
    END IF;
    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_16'; END IF;
 EXECUTE replace(v_def,v_new,$old$    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN$old$);
END $undo_16$;

DO $undo_17$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$AND public._pos_order_type_allowed(OLD.order_type,OLD.table_id)
         AND EXISTS$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>2 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_17'; END IF;
 EXECUTE replace(v_def,v_new,$old$AND public.can_permission('pos.send_kitchen')
         AND EXISTS$old$);
END $undo_17$;

DO $undo_18$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$public._pos_existing_order_type_allowed(CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END)
       AND NOT v_sent_item_void_context$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_18'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context$old$);
END $undo_18$;

DO $undo_19$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$public._pos_order_type_allowed(OLD.order_type,OLD.table_id)$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_19'; END IF;
 EXECUTE replace(v_def,v_new,$old$public.can_permission('pos.order.quick_create')
       AND OLD.order_type='takeaway' AND OLD.table_id IS NULL$old$);
END $undo_19$;

DO $undo_20$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$IF NOT public.can_permission('pos.order.edit') AND NOT EXISTS(
        SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id
          AND public._pos_order_type_allowed(qo.order_type,qo.table_id)
          AND qo.cashier_id=auth.uid() AND qo.status='open'
          AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id)
          AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0))
      ) THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_20'; END IF;
 EXECUTE replace(v_def,v_new,$old$IF NOT public.can_permission('pos.order.create') AND NOT public.can_permission('pos.order.edit') AND NOT (public.can_permission('pos.order.quick_create') AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0)) AND EXISTS(SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id AND qo.order_type='takeaway' AND qo.table_id IS NULL AND qo.cashier_id=auth.uid() AND qo.status='open' AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id))) THEN$old$);
END $undo_20$;

DO $undo_21$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_new text:=$new$IF NOT (public._pos_order_type_allowed(NEW.order_type,NEW.table_id) AND (NEW.status='open' OR (NEW.status='held' AND public.can_permission('pos.hold'))) AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission('pos.discount'))) THEN$new$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_new,'')))/length(v_new)<>1 THEN RAISE EXCEPTION 'POS_TYPE_ROLLBACK_DRIFT_21'; END IF;
 EXECUTE replace(v_def,v_new,$old$IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(NEW.order_type='takeaway' AND NEW.table_id IS NULL AND NEW.status='open' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission('pos.discount')) AND NEW.cashier_id=auth.uid() AND public.user_may_access_branch(NEW.branch_id),false)) THEN$old$);
END $undo_21$;

DO $restore_full$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure)<>'aedf66725bb85d6e6022d900b9fa62d2' THEN RAISE EXCEPTION 'POS_TYPE_FULL_ROLLBACK_DRIFT'; END IF; EXECUTE $original$CREATE OR REPLACE FUNCTION public.enqueue_cloud_kitchen_print(p_branch_id uuid, p_station_code text, p_payload jsonb, p_idempotency_key text)
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
$original$; END $restore_full$;
DO $restore_full$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public._is_branch_captain_order_user(uuid,uuid)'::regprocedure)<>'c1a1b337385c6da70f39eba0b397d1d7' THEN RAISE EXCEPTION 'POS_TYPE_FULL_ROLLBACK_DRIFT'; END IF; EXECUTE $original$CREATE OR REPLACE FUNCTION public._is_branch_captain_order_user(p_user_id uuid, p_branch_id uuid)
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
$original$; END $restore_full$;
DO $restore_full$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure)<>'8d60b7aa055b04dbd5e97617c55f2db8' THEN RAISE EXCEPTION 'POS_TYPE_FULL_ROLLBACK_DRIFT'; END IF; EXECUTE $original$CREATE OR REPLACE FUNCTION public._send_to_kitchen_core_20260914(p_order_id uuid, p_sent_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_id uuid;
  v_status text;
  v_order_number text;
  v_table_id uuid;
  v_table_name text;
  v_order_type text;
  v_guest_count integer;
  v_warehouse_id uuid;
  v_sent_items jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_all_sent boolean := false;
  v_row record;
  v_inventory jsonb;
  v_failure_product uuid;
  v_failure_name text;
  v_failure_error text;
  v_failure_detail text;
  v_first_sent_at timestamptz;
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_effective_sent_by uuid;
  v_snapshot jsonb;
BEGIN
  BEGIN
    IF NOT v_is_service_role AND auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT branch_id, status, order_number, table_id, order_type, guest_count, inventory_warehouse_id
    INTO v_branch_id, v_status, v_order_number, v_table_id, v_order_type, v_guest_count, v_warehouse_id
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_branch_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    IF NOT v_is_service_role THEN
      IF NOT public.user_may_access_branch(v_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF NOT (public.is_platform_admin() OR public.can_permission('pos.send_kitchen')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'detail', 'pos.send_kitchen');
      END IF;
    END IF;

    IF v_status NOT IN ('open', 'held') THEN
      RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_EDITABLE');
    END IF;

    IF v_warehouse_id IS NULL THEN
      SELECT w.id INTO v_warehouse_id
      FROM public.warehouses w
      WHERE w.branch_id = v_branch_id
        AND w.is_active = true
      ORDER BY COALESCE(w.is_default, false) DESC, w.created_at, w.id
      LIMIT 1;

      IF v_warehouse_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'WAREHOUSE_NOT_FOUND');
      END IF;

      UPDATE public.orders
      SET inventory_warehouse_id = v_warehouse_id
      WHERE id = p_order_id;
    END IF;

    IF v_table_id IS NOT NULL THEN
      SELECT name INTO v_table_name
      FROM public.dining_tables
      WHERE id = v_table_id
        AND branch_id = v_branch_id;
    END IF;

    v_effective_sent_by := CASE
      WHEN v_is_service_role THEN COALESCE(p_sent_by, auth.uid())
      ELSE auth.uid()
    END;

    CREATE TEMP TABLE IF NOT EXISTS pg_temp.kns_delta (
      order_item_id uuid PRIMARY KEY,
      send_id uuid,
      event_id uuid,
      delta_quantity numeric(14,4) NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.kns_delta;

    INSERT INTO pg_temp.kns_delta(order_item_id, event_id, delta_quantity)
    SELECT oi.id, gen_random_uuid(), oi.quantity - COALESCE(s.sent_quantity, 0)
    FROM public.order_items oi
    LEFT JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.quantity > COALESCE(s.sent_quantity, 0);

    IF EXISTS (
      SELECT 1
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c ON c.id = p.category_id AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks ON ks.id = c.kitchen_station_id AND ks.is_active = true
      WHERE (
        p.category_id IS NOT NULL
        AND (
          c.id IS NULL
          OR ks.id IS NULL
          OR ks.branch_id IS DISTINCT FROM v_branch_id
          OR lower(btrim(ks.code)) = 'cashier'
        )
      )
      OR (
        p.category_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.kitchen_stations default_ks
          WHERE default_ks.branch_id = v_branch_id
            AND lower(btrim(default_ks.code)) = 'main'
            AND default_ks.is_active = true
        )
      )
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'KITCHEN_STATION_NOT_CONFIGURED'
      );
    END IF;

    FOR v_row IN
      SELECT
        d.order_item_id,
        d.event_id,
        d.delta_quantity,
        oi.product_id,
        oi.modifier_option_ids,
        p.name AS product_name
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      ORDER BY oi.created_at, oi.id
    LOOP
      v_failure_product := v_row.product_id;
      v_failure_name := v_row.product_name;
      v_failure_error := NULL;
      v_failure_detail := NULL;

      v_inventory := public._deduct_kitchen_raw_components(
        v_row.product_id,
        v_branch_id,
        v_warehouse_id,
        v_row.delta_quantity,
        to_jsonb(COALESCE(v_row.modifier_option_ids, '{}'::uuid[])),
        v_row.event_id,
        v_order_number,
        v_effective_sent_by
      );

      IF COALESCE((v_inventory->>'success')::boolean, false) IS NOT TRUE THEN
        v_failure_error := COALESCE(
          NULLIF(v_inventory->>'error', ''),
          'KITCHEN_RAW_DEDUCTION_FAILED'
        );
        v_failure_detail := COALESCE(
          NULLIF(v_inventory->>'detail', ''),
          v_failure_error
        );
        RAISE EXCEPTION 'KITCHEN_RAW_DEDUCTION_FAILED';
      END IF;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'raw_material_id', e->>'raw_material_id',
            'raw_name', e->>'raw_name',
            'quantity', (e->>'quantity')::numeric
          )
          ORDER BY e->>'raw_material_id'
        ),
        '[]'::jsonb
      )
      INTO v_snapshot
      FROM jsonb_array_elements(
        COALESCE(v_inventory->'raw_materials_deducted', '[]'::jsonb)
      ) e;

      INSERT INTO public.order_kitchen_inventory_events(
        id,
        branch_id,
        warehouse_id,
        order_id,
        order_item_id,
        sent_quantity,
        total_cost,
        created_by,
        component_snapshot,
        snapshot_version
      ) VALUES (
        v_row.event_id,
        v_branch_id,
        v_warehouse_id,
        p_order_id,
        v_row.order_item_id,
        v_row.delta_quantity,
        COALESCE((v_inventory->>'total_cost')::numeric, 0),
        v_effective_sent_by,
        v_snapshot,
        2
      );

      INSERT INTO public.order_kitchen_inventory_effects(
        event_id,
        branch_id,
        warehouse_id,
        target_type,
        target_id,
        quantity,
        total_cost
      )
      SELECT
        v_row.event_id,
        v_branch_id,
        v_warehouse_id,
        'raw_material',
        (e->>'raw_material_id')::uuid,
        (e->>'quantity')::numeric,
        COALESCE((e->>'total_cost')::numeric, 0)
      FROM jsonb_array_elements(
        COALESCE(v_inventory->'raw_materials_deducted', '[]'::jsonb)
      ) e
      WHERE COALESCE((e->>'quantity')::numeric, 0) > 0;

      v_failure_product := NULL;
      v_failure_name := NULL;
      v_failure_error := NULL;
      v_failure_detail := NULL;
    END LOOP;

    WITH candidates AS (
      SELECT d.order_item_id, d.delta_quantity, oi.quantity AS target_quantity
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
    ),
    upserted AS (
      INSERT INTO public.order_kitchen_sends(
        branch_id,
        order_id,
        order_item_id,
        sent_at,
        sent_by,
        sent_quantity
      )
      SELECT
        v_branch_id,
        p_order_id,
        c.order_item_id,
        now(),
        v_effective_sent_by,
        c.target_quantity
      FROM candidates c
      ON CONFLICT (order_item_id) DO UPDATE
      SET sent_quantity = EXCLUDED.sent_quantity,
          sent_at = now(),
          sent_by = EXCLUDED.sent_by
      WHERE public.order_kitchen_sends.sent_quantity < EXCLUDED.sent_quantity
      RETURNING id, order_item_id
    )
    UPDATE pg_temp.kns_delta d
    SET send_id = u.id
    FROM upserted u
    WHERE u.order_item_id = d.order_item_id;

    UPDATE public.order_kitchen_inventory_events e
    SET kitchen_send_id = d.send_id
    FROM pg_temp.kns_delta d
    WHERE e.id = d.event_id;

    SELECT count(*) INTO v_count
    FROM pg_temp.kns_delta;

    IF v_count > 0 THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'send_id', d.send_id,
            'order_item_id', d.order_item_id,
            'product_id', oi.product_id,
            'product_name', p.name,
            'unit_name', oi.unit_name,
            'station_code', CASE
              WHEN p.category_id IS NULL THEN 'main'
              ELSE ks.code
            END,
            'quantity', d.delta_quantity,
            'current_quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'discount_amount', oi.discount_amount,
            'bonus_quantity', oi.bonus_quantity,
            'total', oi.total,
            'notes', oi.notes,
            'modifiers', COALESCE(oi.modifiers_snapshot, '[]'::jsonb)
          )
          ORDER BY oi.created_at
        ),
        '[]'::jsonb
      )
      INTO v_sent_items
      FROM pg_temp.kns_delta d
      JOIN public.order_items oi ON oi.id = d.order_item_id
      LEFT JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.categories c
        ON c.id = p.category_id
       AND c.branch_id = v_branch_id
      LEFT JOIN public.kitchen_stations ks
        ON ks.id = c.kitchen_station_id
       AND ks.is_active = true;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      LEFT JOIN public.order_kitchen_sends s
        ON s.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND oi.quantity > COALESCE(s.sent_quantity, 0)
    )
    INTO v_all_sent;

    SELECT min(s.sent_at)
    INTO v_first_sent_at
    FROM public.order_kitchen_sends s
    WHERE s.order_id = p_order_id;

    IF v_first_sent_at IS NOT NULL THEN
      UPDATE public.orders
      SET kitchen_status = CASE
            WHEN kitchen_status = 'pending' THEN 'sent'
            ELSE kitchen_status
          END,
          kitchen_sent_at = COALESCE(kitchen_sent_at, v_first_sent_at)
      WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', p_order_id,
      'order_number', v_order_number,
      'table_name', v_table_name,
      'order_type', v_order_type,
      'guest_count', v_guest_count,
      'warehouse_id', v_warehouse_id,
      'sent', v_sent_items,
      'items_sent_count', v_count,
      'all_sent', v_all_sent,
      'inventory_deducted', v_count > 0
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_failure_error, 'TRANSACTION_FAILED'),
      'product_id', v_failure_product,
      'product_name', v_failure_name,
      'detail', COALESCE(v_failure_detail, SQLERRM)
    );
  END;
END;
$function$
$original$; END $restore_full$;
DO $restore_full$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure)<>'0d0601a8c4e3a161ac7414fd9e6df5c0' THEN RAISE EXCEPTION 'POS_TYPE_FULL_ROLLBACK_DRIFT'; END IF; EXECUTE $original$CREATE OR REPLACE FUNCTION public.create_order(p_branch_id uuid, p_order_type text DEFAULT 'dine_in'::text, p_table_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_guest_count integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_subtotal numeric DEFAULT 0, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT 'amount'::text, p_tax_amount numeric DEFAULT 0, p_total numeric DEFAULT 0, p_cashier_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_id uuid;
  v_number jsonb;
  v_user_branch uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,4);
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_effective_cashier uuid;
BEGIN
  BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'EMPTY_CART');
    END IF;

    IF NOT v_is_service_role THEN
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
      END IF;
      IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(p_order_type='takeaway' AND p_table_id IS NULL AND (public.can_permission('pos.discount') OR (COALESCE(p_discount_amount,0)=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi WHERE COALESCE((qi->>'discount_amount')::numeric,0)<>0 OR COALESCE((qi->>'bonus_quantity')::numeric,0)<>0))),false)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED', 'permission', 'pos.order.create');
      END IF;
      IF NOT public.user_may_access_branch(p_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH');
      END IF;
      IF p_cashier_id IS NOT NULL AND p_cashier_id IS DISTINCT FROM v_uid THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN',
          'detail', 'Authenticated POS users cannot create an order in another operator''s name.'
        );
      END IF;
      v_effective_cashier := v_uid;
    ELSE
      v_effective_cashier := p_cashier_id;
    END IF;

    -- A dine-in order must point at a table in the same branch.
    IF p_table_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.dining_tables WHERE id = p_table_id AND branch_id = p_branch_id AND is_active
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_NOT_IN_BRANCH', 'table_id', p_table_id);
    END IF;

    -- Occupancy guard: a table that already has an open/held order cannot take
    -- a second order (H2). The one path that legitimately bypasses this is a
    -- manager resuming the SAME order, which routes to update_order instead.
    IF p_table_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.table_id = p_table_id
        AND o.status IN ('open', 'held')
        AND EXISTS (
          SELECT 1 FROM public.order_items oi
          WHERE oi.order_id = o.id
            AND oi.quantity > 0
        )
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'TABLE_BUSY',
        'detail', 'This table already has an open order.');
    END IF;

    -- Validate every line before writing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
      IF v_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY', 'product_id', v_product_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND branch_id = p_branch_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_IN_BRANCH', 'product_id', v_product_id);
      END IF;
    END LOOP;

    v_number := public.next_document_number('order');
    IF NOT (v_number->>'success')::boolean THEN
      RETURN jsonb_build_object('success', false, 'error', 'NUMBERING_FAILED', 'detail', v_number->>'error');
    END IF;

    INSERT INTO public.orders (order_number, branch_id, order_type, status, table_id, customer_id,
      cashier_id, guest_count, notes, subtotal, discount_amount, discount_type, tax_amount, total)
    VALUES (v_number->>'number', p_branch_id, COALESCE(p_order_type, 'dine_in'), 'open', p_table_id,
      p_customer_id, v_effective_cashier, p_guest_count, p_notes,
      COALESCE(p_subtotal, 0), COALESCE(p_discount_amount, 0), COALESCE(p_discount_type, 'amount'),
      COALESCE(p_tax_amount, 0), COALESCE(p_total, 0))
    RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.order_items (order_id, product_id, unit_name, quantity, unit_price,
        discount_amount, bonus_quantity, total, modifier_option_ids, notes)
      VALUES (v_order_id, (v_item->>'product_id')::uuid,
        COALESCE(v_item->>'unit_name', 'piece'),
        COALESCE((v_item->>'quantity')::numeric, 1),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'discount_amount')::numeric, 0),
        COALESCE((v_item->>'bonus_quantity')::numeric, 0),
        COALESCE((v_item->>'total')::numeric, 0),
        ARRAY(SELECT NULLIF(value, '')::uuid FROM jsonb_array_elements_text(COALESCE(v_item->'modifier_option_ids', '[]'::jsonb))),
        NULLIF(v_item->>'notes', ''));
    END LOOP;

    IF p_table_id IS NOT NULL THEN
      UPDATE public.dining_tables SET status = 'occupied', updated_at = now() WHERE id = p_table_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_number->>'number');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'TRANSACTION_FAILED', 'detail', SQLERRM);
  END;
END;
$function$
$original$; END $restore_full$;
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_select_order_kitchen_sends' AND (COALESCE(regexp_replace(qual,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($after$(is_pos_admin() OR ((branch_id = get_branch_id()) AND (can_permission('pos.view'::text) OR can_permission('pos.kds_view'::text))))$after$,'[[:space:]]','','g'))) THEN RAISE EXCEPTION 'POS_TYPE_POLICY_ROLLBACK_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_select_order_kitchen_sends ON public.order_kitchen_sends USING ((is_pos_admin() OR ((branch_id = get_branch_id()) AND (can_permission('pos.send_kitchen'::text) OR can_permission('pos.kds_view'::text)))));
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends' AND (COALESCE(regexp_replace(with_check,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($after$(is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id)))$after$,'[[:space:]]','','g'))) THEN RAISE EXCEPTION 'POS_TYPE_POLICY_ROLLBACK_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_write_order_kitchen_sends ON public.order_kitchen_sends WITH CHECK ((is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text))));
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends_del' AND (COALESCE(regexp_replace(qual,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($after$(is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id)))$after$,'[[:space:]]','','g'))) THEN RAISE EXCEPTION 'POS_TYPE_POLICY_ROLLBACK_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_write_order_kitchen_sends_del ON public.order_kitchen_sends USING ((is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text))));
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends_upd' AND (COALESCE(regexp_replace(qual,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($after$(is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id)))$after$,'[[:space:]]','','g') OR COALESCE(regexp_replace(with_check,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($after$(is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id)))$after$,'[[:space:]]','','g'))) THEN RAISE EXCEPTION 'POS_TYPE_POLICY_ROLLBACK_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_write_order_kitchen_sends_upd ON public.order_kitchen_sends USING ((is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text)))) WITH CHECK ((is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text))));

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
