-- Review candidate only. No production apply before verified release approval.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

CREATE FUNCTION public._pos_order_type_allowed(p_type text, p_table_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp AS $function$
 SELECT COALESCE(
   p_type IN ('dine_in','takeaway','drive_thru','delivery')
   AND (p_table_id IS NULL OR p_type='dine_in')
   AND public.can_permission('pos.order.' || p_type),false);
$function$;
REVOKE ALL ON FUNCTION public._pos_order_type_allowed(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._pos_order_type_allowed(text,uuid) TO authenticated,service_role;

CREATE FUNCTION public._pos_existing_order_type_allowed(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp AS $function$
 SELECT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=p_order_id
   AND public._pos_order_type_allowed(o.order_type,o.table_id));
$function$;
REVOKE ALL ON FUNCTION public._pos_existing_order_type_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._pos_existing_order_type_allowed(uuid) TO authenticated,service_role;

-- Each replacement checks an exact anchor count and retains the current full
-- writer definition, security mode, grants, ownership, inventory and print logic.
DO $patch_0$
DECLARE v_def text:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure); v_old text:=$old$IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(p_order_type='takeaway' AND p_table_id IS NULL AND (public.can_permission('pos.discount') OR (COALESCE(p_discount_amount,0)=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi WHERE COALESCE((qi->>'discount_amount')::numeric,0)<>0 OR COALESCE((qi->>'bonus_quantity')::numeric,0)<>0))),false)) THEN$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_0'; END IF;
 EXECUTE replace(v_def,v_old,$new$IF NOT public._pos_order_type_allowed(p_order_type,p_table_id) THEN$new$);
END $patch_0$;

DO $patch_1$
DECLARE v_def text:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure); v_old text:=$old$      v_effective_cashier := v_uid;$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_1'; END IF;
 EXECUTE replace(v_def,v_old,$new$      IF NOT public.can_permission('pos.discount') AND (
        COALESCE(p_discount_amount,0)<>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) qi
          WHERE COALESCE((qi->>'discount_amount')::numeric,0)<>0 OR COALESCE((qi->>'bonus_quantity')::numeric,0)<>0)
      ) THEN RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.discount'); END IF;
      v_effective_cashier := v_uid;$new$);
END $patch_1$;

DO $patch_2$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(NEW.order_type='takeaway' AND NEW.table_id IS NULL AND NEW.status='open' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission('pos.discount')) AND NEW.cashier_id=auth.uid() AND public.user_may_access_branch(NEW.branch_id),false)) THEN$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_2'; END IF;
 EXECUTE replace(v_def,v_old,$new$IF NOT (public._pos_order_type_allowed(NEW.order_type,NEW.table_id) AND NEW.status='open' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission('pos.discount'))) THEN$new$);
END $patch_2$;

DO $patch_3$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$IF NOT public.can_permission('pos.order.create') AND NOT public.can_permission('pos.order.edit') AND NOT (public.can_permission('pos.order.quick_create') AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0)) AND EXISTS(SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id AND qo.order_type='takeaway' AND qo.table_id IS NULL AND qo.cashier_id=auth.uid() AND qo.status='open' AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id))) THEN$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_3'; END IF;
 EXECUTE replace(v_def,v_old,$new$IF NOT public.can_permission('pos.order.edit') AND NOT EXISTS(
        SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id
          AND public._pos_order_type_allowed(qo.order_type,qo.table_id)
          AND qo.cashier_id=auth.uid() AND qo.status='open'
          AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id)
          AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0))
      ) THEN$new$);
END $patch_3$;

DO $patch_4$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$public.can_permission('pos.order.quick_create')
       AND OLD.order_type='takeaway' AND OLD.table_id IS NULL$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_4'; END IF;
 EXECUTE replace(v_def,v_old,$new$public._pos_order_type_allowed(OLD.order_type,OLD.table_id)$new$);
END $patch_4$;

DO $patch_5$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_5'; END IF;
 EXECUTE replace(v_def,v_old,$new$public._pos_existing_order_type_allowed(CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END)
       AND NOT v_sent_item_void_context$new$);
END $patch_5$;

DO $patch_6$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$AND public.can_permission('pos.send_kitchen')
         AND EXISTS$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>2 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_6'; END IF;
 EXECUTE replace(v_def,v_old,$new$AND public._pos_order_type_allowed(OLD.order_type,OLD.table_id)
         AND EXISTS$new$);
END $patch_6$;

DO $patch_7$
DECLARE v_def text:=pg_get_functiondef('public.guard_pos_operator_ownership()'::regprocedure); v_old text:=$old$    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_7'; END IF;
 EXECUTE replace(v_def,v_old,$new$    IF (NEW.table_id IS NOT NULL AND NEW.order_type<>'dine_in')
       OR (NEW.order_type IS DISTINCT FROM OLD.order_type
         AND NOT public._pos_order_type_allowed(NEW.order_type,NEW.table_id)) THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type';
    END IF;
    IF NEW.table_id IS DISTINCT FROM OLD.table_id AND NOT public.can_permission('pos.order.transfer') THEN$new$);
END $patch_7$;

DO $patch_8$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_old text:=$old$public.can_permission('pos.send_kitchen')$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_8'; END IF;
 EXECUTE replace(v_def,v_old,$new$public._pos_existing_order_type_allowed(p_order_id)$new$);
END $patch_8$;

DO $patch_9$
DECLARE v_def text:=pg_get_functiondef('public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure); v_old text:=$old$public.can_permission('pos.send_kitchen')$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_9'; END IF;
 EXECUTE replace(v_def,v_old,$new$public._pos_order_type_allowed(v_order_type,v_table_id)$new$);
END $patch_9$;

DO $patch_10$
DECLARE v_def text:=pg_get_functiondef('public._pos_action_context_matches(uuid,text)'::regprocedure); v_old text:=$old$AND public.can_permission(p_permission)$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_10'; END IF;
 EXECUTE replace(v_def,v_old,$new$AND CASE WHEN p_permission='pos.send_kitchen' THEN public._pos_existing_order_type_allowed(p_order_id) ELSE public.can_permission(p_permission) END$new$);
END $patch_10$;

DO $patch_11$
DECLARE v_def text:=pg_get_functiondef('public._is_branch_captain_order_user(uuid,uuid)'::regprocedure); v_old text:=$old$AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.order.create'$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_11'; END IF;
 EXECUTE replace(v_def,v_old,$new$AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.order.dine_in'$new$);
END $patch_11$;

DO $patch_12$
DECLARE v_def text:=pg_get_functiondef('public._is_branch_captain_order_user(uuid,uuid)'::regprocedure); v_old text:=$old$      AND COALESCE(r.permissions,'[]'::jsonb) ? 'pos.send_kitchen'$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_12'; END IF;
 EXECUTE replace(v_def,v_old,$new$$new$);
END $patch_12$;

DO $patch_13$
DECLARE v_def text:=pg_get_functiondef('public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure); v_old text:=$old$DECLARE v_source_branch uuid;$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_13'; END IF;
 EXECUTE replace(v_def,v_old,$new$DECLARE v_source_order_id uuid; v_source_branch uuid;$new$);
END $patch_13$;

DO $patch_14$
DECLARE v_def text:=pg_get_functiondef('public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure); v_old text:=$old$public.can_permission('pos.send_kitchen')$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_14'; END IF;
 EXECUTE replace(v_def,v_old,$new$(public.can_permission('pos.print_kitchen') OR public.can_permission('pos.order.dine_in') OR public.can_permission('pos.order.takeaway') OR public.can_permission('pos.order.drive_thru') OR public.can_permission('pos.order.delivery'))$new$);
END $patch_14$;

DO $patch_15$
DECLARE v_def text:=pg_get_functiondef('public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure); v_old text:=$old$SELECT branch_id INTO v_source_branch FROM public.orders WHERE id=(p_payload->>'order_id')::uuid;$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_15'; END IF;
 EXECUTE replace(v_def,v_old,$new$SELECT id,branch_id INTO v_source_order_id,v_source_branch FROM public.orders WHERE id=(p_payload->>'order_id')::uuid;$new$);
END $patch_15$;

DO $patch_16$
DECLARE v_def text:=pg_get_functiondef('public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure); v_old text:=$old$SELECT count(*),min(branch_id::text)::uuid INTO v_source_matches,v_source_branch$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_16'; END IF;
 EXECUTE replace(v_def,v_old,$new$SELECT count(*),min(branch_id::text)::uuid,min(id::text)::uuid INTO v_source_matches,v_source_branch,v_source_order_id$new$);
END $patch_16$;

DO $patch_17$
DECLARE v_def text:=pg_get_functiondef('public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure); v_old text:=$old$INSERT INTO public.cloud_print_jobs($old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_17'; END IF;
 EXECUTE replace(v_def,v_old,$new$IF v_source_order_id IS NOT NULL THEN
  IF NOT public._pos_existing_order_type_allowed(v_source_order_id) THEN
    RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.order.type');
  END IF;
ELSIF NOT public.can_permission('pos.print_kitchen') THEN
  RETURN jsonb_build_object('success',false,'error','PERMISSION_DENIED','permission','pos.print_kitchen');
END IF;
INSERT INTO public.cloud_print_jobs($new$);
END $patch_17$;

DO $patch_18$
DECLARE v_def text:=pg_get_functiondef('public.create_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid)'::regprocedure); v_old text:=$old$'permission', 'pos.order.create'$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_18'; END IF;
 EXECUTE replace(v_def,v_old,$new$'permission', 'pos.order.type'$new$);
END $patch_18$;

DO $patch_19$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_old text:=$old$'permission','pos.send_kitchen'$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_19'; END IF;
 EXECUTE replace(v_def,v_old,$new$'permission','pos.order.type'$new$);
END $patch_19$;

DO $patch_20$
DECLARE v_def text:=pg_get_functiondef('public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure); v_old text:=$old$'detail', 'pos.send_kitchen'$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_20'; END IF;
 EXECUTE replace(v_def,v_old,$new$'detail', 'pos.order.type'$new$);
END $patch_20$;

DO $patch_21$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create'; END IF;$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_21'; END IF;
 EXECUTE replace(v_def,v_old,$new$THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type'; END IF;$new$);
END $patch_21$;

DO $patch_22$
DECLARE v_def text:=pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure); v_old text:=$old$AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_22'; END IF;
 EXECUTE replace(v_def,v_old,$new$AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.type';$new$);
END $patch_22$;

DO $patch_23$
DECLARE v_def text:=pg_get_functiondef('public.send_to_kitchen(uuid,uuid)'::regprocedure); v_old text:=$old$    IF v_order.cashier_id IS DISTINCT FROM v_uid THEN
      PERFORM set_config('app.pos_action_authorized','1',true);
      PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
      PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
      PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);
    END IF;$old$;
BEGIN
 IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN RAISE EXCEPTION 'POS_TYPE_BASELINE_MISMATCH_23'; END IF;
 EXECUTE replace(v_def,v_old,$new$    PERFORM set_config('app.pos_action_authorized','1',true);
    PERFORM set_config('app.pos_action_actor_id',v_uid::text,true);
    PERFORM set_config('app.pos_action_order_id',p_order_id::text,true);
    PERFORM set_config('app.pos_action_permission','pos.send_kitchen',true);$new$);
END $patch_23$;

DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_select_order_kitchen_sends' AND (COALESCE(regexp_replace(qual,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($before$(is_pos_admin() OR ((branch_id = get_branch_id()) AND (can_permission('pos.send_kitchen'::text) OR can_permission('pos.kds_view'::text))))$before$,'[[:space:]]','','g'))) OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_select_order_kitchen_sends') THEN RAISE EXCEPTION 'POS_TYPE_POLICY_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_select_order_kitchen_sends ON public.order_kitchen_sends USING ((is_pos_admin() OR ((branch_id = get_branch_id()) AND (can_permission('pos.view'::text) OR can_permission('pos.kds_view'::text)))));
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends' AND (COALESCE(regexp_replace(with_check,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($before$(is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text)))$before$,'[[:space:]]','','g'))) OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends') THEN RAISE EXCEPTION 'POS_TYPE_POLICY_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_write_order_kitchen_sends ON public.order_kitchen_sends WITH CHECK ((is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id))));
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends_del' AND (COALESCE(regexp_replace(qual,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($before$(is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text)))$before$,'[[:space:]]','','g'))) OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends_del') THEN RAISE EXCEPTION 'POS_TYPE_POLICY_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_write_order_kitchen_sends_del ON public.order_kitchen_sends USING ((is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id))));
DO $policy$ BEGIN IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends_upd' AND (COALESCE(regexp_replace(qual,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($before$(is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text)))$before$,'[[:space:]]','','g') OR COALESCE(regexp_replace(with_check,'[[:space:]]','','g'),'') IS DISTINCT FROM regexp_replace($before$(is_pos_admin() OR ((branch_id = get_branch_id()) AND can_permission('pos.send_kitchen'::text)))$before$,'[[:space:]]','','g'))) OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_kitchen_sends' AND policyname='auth_write_order_kitchen_sends_upd') THEN RAISE EXCEPTION 'POS_TYPE_POLICY_DRIFT'; END IF; END $policy$;
ALTER POLICY auth_write_order_kitchen_sends_upd ON public.order_kitchen_sends USING ((is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id)))) WITH CHECK ((is_pos_admin() OR ((branch_id = get_branch_id()) AND _pos_existing_order_type_allowed(order_id))));
-- Conservative one-time conversion, independent of role names.
-- Generic send-only roles gain no creation capability. Quick is always explicit.
UPDATE public.roles r SET permissions=(
 SELECT COALESCE(jsonb_agg(DISTINCT p ORDER BY p),'[]'::jsonb) FROM (
  SELECT value p FROM jsonb_array_elements_text(COALESCE(r.permissions,'[]'::jsonb))
   WHERE value NOT IN ('pos.order.create','pos.order.quick_create','pos.send_kitchen')
  UNION ALL SELECT 'pos.order.takeaway' WHERE r.permissions ? 'pos.order.quick_create'
  UNION ALL SELECT unnest(ARRAY['pos.order.dine_in','pos.order.drive_thru','pos.order.delivery'])
   WHERE r.permissions ? 'pos.order.create' AND r.permissions ? 'pos.send_kitchen'
 ) x
) WHERE r.permissions ?| ARRAY['pos.order.create','pos.order.quick_create','pos.send_kitchen'];

NOTIFY pgrst,'reload schema';
COMMIT;
