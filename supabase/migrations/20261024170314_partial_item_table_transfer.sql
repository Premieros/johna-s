BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
-- Additive lineage only: no historical row backfill or inventory movement.
ALTER TABLE public.order_kitchen_inventory_events ADD COLUMN transfer_origin_event_id uuid;
COMMENT ON COLUMN public.order_kitchen_inventory_events.transfer_origin_event_id IS 'Original consumption event retained by a quantity transfer; used only to restore legacy unit consumption sources.';

CREATE FUNCTION public._pos_transfer_snapshot_part(p_snapshot jsonb,p_take numeric,p_total numeric,p_remainder boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(component || jsonb_build_object('quantity',
   CASE WHEN p_remainder THEN (component->>'quantity')::numeric-round((component->>'quantity')::numeric*p_take/p_total,6)
   ELSE round((component->>'quantity')::numeric*p_take/p_total,6) END)
   || CASE WHEN component ? 'extended_cost' AND component->>'extended_cost' IS NOT NULL THEN
     jsonb_build_object('extended_cost',CASE WHEN p_remainder THEN (component->>'extended_cost')::numeric-round((component->>'extended_cost')::numeric*p_take/p_total,6)
     ELSE round((component->>'extended_cost')::numeric*p_take/p_total,6) END) ELSE '{}'::jsonb END ORDER BY ord), '[]'::jsonb)
 FROM jsonb_array_elements(p_snapshot) WITH ORDINALITY AS x(component,ord);
$$;
REVOKE ALL ON FUNCTION public._pos_transfer_snapshot_part(jsonb,numeric,numeric,boolean) FROM PUBLIC,anon,authenticated;

-- Not an authority by itself: called from existing guards, which additionally
-- validate exact row changes and the allocated send/event quantities.
CREATE FUNCTION public._pos_partial_transfer_context(p_order_id uuid,p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c jsonb;
BEGIN
 c:=NULLIF(current_setting('app.pos_item_quantity_transfer_state',true),'')::jsonb;
 IF c IS NULL OR auth.uid() IS NULL OR c->>'actor_id' IS DISTINCT FROM auth.uid()::text
   OR NOT public.can_permission('pos.order.transfer')
   OR p_order_id IS DISTINCT FROM (c->>'source_order_id')::uuid
   OR p_item_id NOT IN ((c->>'source_item_id')::uuid,(c->>'new_item_id')::uuid) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders s JOIN public.orders t ON t.id=(c->>'target_order_id')::uuid
   JOIN public.order_items i ON i.id=(c->>'source_item_id')::uuid AND i.order_id=s.id
   WHERE s.id=p_order_id AND s.branch_id=t.branch_id AND s.status IN ('open','held') AND t.status IN ('open','held')
   AND public.user_may_access_branch(s.branch_id)) THEN RETURN NULL; END IF;
 RETURN c;
END $$;
REVOKE ALL ON FUNCTION public._pos_partial_transfer_context(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public._pos_transfer_pair_snapshot(p_source uuid,p_target uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'order_ids',jsonb_build_array(p_source,p_target),
  'orders',(SELECT COALESCE(jsonb_agg(to_jsonb(o)),'[]') FROM public.orders o WHERE o.id IN(p_source,p_target)),
  'tables',(SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]') FROM public.dining_tables t WHERE t.id IN(SELECT table_id FROM public.orders WHERE id IN(p_source,p_target))),
  'orderItems',(SELECT COALESCE(jsonb_agg(to_jsonb(i)),'[]') FROM public.order_items i WHERE i.order_id IN(p_source,p_target)),
  'kitchenSends',(SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM public.order_kitchen_sends s WHERE s.order_id IN(p_source,p_target)));
$$;
REVOKE ALL ON FUNCTION public._pos_transfer_pair_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Existing canonical command calls this helper under its unchanged security
-- and permission checks. No stock writer, recipe lookup or print enqueue.
CREATE FUNCTION public._pos_split_transfer_line(p_order uuid,p_item uuid,p_take numeric,p_target uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE served_row public.order_kitchen_served_quantities%ROWTYPE; served_take numeric;
 i public.order_items%ROWTYPE; s public.order_kitchen_sends%ROWTYPE; e public.order_kitchen_inventory_events%ROWTYPE;
 n uuid:=gen_random_uuid(); new_send uuid; new_event uuid; remaining numeric; take_event numeric; moved_cost numeric;
 moved_discount numeric; moved_bonus numeric; moved_total numeric; sent_take numeric; ctx jsonb;
BEGIN
 SELECT * INTO STRICT i FROM public.order_items WHERE id=p_item AND order_id=p_order FOR UPDATE;
 IF p_take<=0 OR p_take>=i.quantity OR round(p_take,4)<>p_take THEN RAISE EXCEPTION 'INVALID_TRANSFER_QUANTITY'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_inventory_consumptions WHERE order_id=p_order AND order_item_id=i.id AND consumed_quantity>reversed_quantity) THEN
  RAISE EXCEPTION 'TRANSFER_LEGACY_CONSUMPTION_REVIEW_REQUIRED';
 END IF;
 SELECT * INTO s FROM public.order_kitchen_sends WHERE order_item_id=i.id FOR UPDATE;
 IF COALESCE(s.sent_quantity,0)>i.quantity OR abs(COALESCE(s.sent_quantity,0)-COALESCE((
   SELECT sum(sent_quantity-voided_quantity) FROM public.order_kitchen_inventory_events WHERE order_id=p_order AND order_item_id=i.id),0))>0.000001 THEN
  RAISE EXCEPTION 'TRANSFER_SEND_STATE_MISMATCH'; END IF;
 sent_take:=greatest(p_take-greatest(i.quantity-COALESCE(s.sent_quantity,0),0),0);
 moved_discount:=round(i.discount_amount*p_take/i.quantity,2);
 moved_bonus:=round(i.bonus_quantity*p_take/i.quantity,4);
 moved_total:=round(p_take*i.unit_price-moved_discount,2);
 ctx:=jsonb_build_object('actor_id',auth.uid(),'source_order_id',p_order,'target_order_id',p_target,
   'source_item_id',i.id,'new_item_id',n,'source_quantity',i.quantity,'quantity',p_take,
   'discount',moved_discount,'bonus',moved_bonus,'total',moved_total,'sent_quantity',sent_take);
 PERFORM set_config('app.pos_item_quantity_transfer_state',ctx::text,true);
 INSERT INTO public.order_items(id,order_id,product_id,unit_name,quantity,unit_price,discount_amount,bonus_quantity,total,notes,created_at,modifier_option_ids,modifiers_snapshot)
 VALUES(n,p_order,i.product_id,i.unit_name,p_take,i.unit_price,moved_discount,moved_bonus,moved_total,i.notes,i.created_at,i.modifier_option_ids,i.modifiers_snapshot);
 remaining:=sent_take;
 FOR e IN SELECT * FROM public.order_kitchen_inventory_events WHERE order_item_id=i.id AND order_id=p_order
   AND settled_sale_id IS NULL AND sent_quantity>voided_quantity ORDER BY created_at DESC,id DESC FOR UPDATE
 LOOP
  EXIT WHEN remaining<=0;
  take_event:=least(remaining,e.sent_quantity-e.voided_quantity);
  IF take_event=e.sent_quantity AND e.voided_quantity=0 THEN
   UPDATE public.order_kitchen_inventory_events SET order_item_id=n WHERE id=e.id;
  ELSE
   new_event:=gen_random_uuid();moved_cost:=round(e.total_cost*take_event/e.sent_quantity,6);
   PERFORM set_config('app.pos_item_transfer_snapshot_source_event',e.id::text,true);
   INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,kitchen_send_id,
    sent_quantity,voided_quantity,total_cost,settled_sale_id,created_by,created_at,component_snapshot,snapshot_version,transfer_origin_event_id)
   VALUES(new_event,e.branch_id,e.warehouse_id,p_order,n,e.kitchen_send_id,take_event,0,moved_cost,NULL,e.created_by,e.created_at,
    public._pos_transfer_snapshot_part(e.component_snapshot,take_event,e.sent_quantity),e.snapshot_version,COALESCE(e.transfer_origin_event_id,e.id));
   PERFORM set_config('app.pos_item_transfer_snapshot_source_event','',true);
   INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost,created_at)
    SELECT new_event,branch_id,warehouse_id,target_type,target_id,round(quantity*take_event/e.sent_quantity,6),round(total_cost*take_event/e.sent_quantity,6),created_at
    FROM public.order_kitchen_inventory_effects WHERE event_id=e.id;
   UPDATE public.order_kitchen_inventory_effects SET quantity=quantity-round(quantity*take_event/e.sent_quantity,6),
    total_cost=total_cost-round(total_cost*take_event/e.sent_quantity,6) WHERE event_id=e.id;
   UPDATE public.order_kitchen_inventory_events SET sent_quantity=sent_quantity-take_event,total_cost=total_cost-moved_cost,
    component_snapshot=public._pos_transfer_snapshot_part(e.component_snapshot,take_event,e.sent_quantity,true) WHERE id=e.id;
  END IF;
  remaining:=remaining-take_event;
 END LOOP;
 IF remaining>0.000001 THEN RAISE EXCEPTION 'TRANSFER_SENT_QUANTITY_UNAVAILABLE'; END IF;
 IF sent_take>0 THEN
  new_send:=gen_random_uuid();
  INSERT INTO public.order_kitchen_sends(id,branch_id,order_id,order_item_id,sent_at,sent_by,sent_quantity)
    VALUES(new_send,s.branch_id,p_order,n,s.sent_at,s.sent_by,sent_take);
  UPDATE public.order_kitchen_inventory_events SET kitchen_send_id=new_send WHERE order_item_id=n AND order_id=p_order;
  UPDATE public.order_kitchen_sends SET sent_quantity=sent_quantity-sent_take WHERE id=s.id;
 END IF;
 SELECT * INTO served_row FROM public.order_kitchen_served_quantities WHERE order_id=p_order AND order_item_id=i.id FOR UPDATE;
 IF served_row.order_item_id IS NOT NULL THEN
  IF served_row.served_quantity>COALESCE(s.sent_quantity,0) THEN RAISE EXCEPTION 'TRANSFER_SERVED_STATE_MISMATCH'; END IF;
  served_take:=greatest(served_row.served_quantity-(COALESCE(s.sent_quantity,0)-sent_take),0);
  IF served_take>0 THEN
   INSERT INTO public.order_kitchen_served_quantities(order_id,order_item_id,served_quantity,served_at) VALUES(p_order,n,served_take,served_row.served_at);
   UPDATE public.order_kitchen_served_quantities SET served_quantity=served_quantity-served_take WHERE order_id=p_order AND order_item_id=i.id;
  END IF;
 END IF;
 UPDATE public.order_items SET quantity=quantity-p_take,discount_amount=discount_amount-moved_discount,
  bonus_quantity=bonus_quantity-moved_bonus,total=total-moved_total WHERE id=i.id;
 PERFORM set_config('app.pos_item_quantity_transfer_state','',true);
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._pos_split_transfer_line(uuid,uuid,numeric,uuid) FROM PUBLIC,anon,authenticated;

-- Same product action, explicit payload overload. Old 3-argument clients retain
-- their full-row behavior. This wrapper adds no privileged execution mode.
CREATE FUNCTION public.transfer_order_items_to_table(p_order_id uuid,p_order_item_ids uuid[],p_target_table_id uuid,p_transfer jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE old_settings jsonb; k text; result jsonb;
BEGIN
 IF p_transfer IS NULL OR jsonb_typeof(p_transfer)<>'object' OR jsonb_typeof(p_transfer->'quantities') IS DISTINCT FROM 'array' OR NULLIF(p_transfer->>'operation_id','') IS NULL THEN
  RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
 SELECT jsonb_object_agg(key,COALESCE(current_setting(key,true),'')) INTO old_settings FROM unnest(ARRAY[
  'app.pos_item_transfer_quantity_request','app.pos_item_quantity_transfer_state','app.pos_item_transfer_snapshot_source_event',
  'app.pos_item_transfer_new_order_owner_id','app.pos_item_transfer_branch_id','app.pos_item_transfer_source_order_id',
  'app.pos_item_transfer_target_order_id','app.pos_item_transfer_source_table_id','app.pos_item_transfer_target_table_id','app.pos_item_transfer_item_ids']) key;
 BEGIN
  PERFORM set_config('app.pos_item_transfer_quantity_request',p_transfer::text,true);
  result:=public.transfer_order_items_to_table(p_order_id,p_order_item_ids,p_target_table_id);
 EXCEPTION WHEN OTHERS THEN
  FOR k IN SELECT jsonb_object_keys(old_settings) LOOP PERFORM set_config(k,old_settings->>k,true); END LOOP;
  RAISE;
 END;
 FOR k IN SELECT jsonb_object_keys(old_settings) LOOP PERFORM set_config(k,old_settings->>k,true); END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.transfer_order_items_to_table(uuid,uuid[],uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_order_items_to_table(uuid,uuid[],uuid,jsonb) TO authenticated,service_role;

DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public._capture_kitchen_ingredient_prices()'::regprocedure) NOT IN ('4c958bda8fe9cdcc2079662e556a9d2f') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:_capture_kitchen_ingredient_prices'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public._capture_kitchen_ingredient_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transfer_source public.order_kitchen_inventory_events%ROWTYPE;
  v_transfer_context jsonb;
  v_raw_ids uuid[];
  v_prices jsonb := '{}'::jsonb;
  v_component jsonb;
  v_price jsonb;
  v_components jsonb := '[]'::jsonb;
  v_unit_cost numeric;
  v_quantity numeric;
  v_lookup_failed boolean := false;
BEGIN
  IF NEW.transfer_origin_event_id IS NOT NULL THEN
    v_transfer_context:=public._pos_partial_transfer_context(NEW.order_id,NEW.order_item_id);
    SELECT * INTO v_transfer_source FROM public.order_kitchen_inventory_events
      WHERE id=NULLIF(current_setting('app.pos_item_transfer_snapshot_source_event',true),'')::uuid;
    IF v_transfer_context IS NULL OR v_transfer_source.id IS NULL
      OR v_transfer_source.order_id IS DISTINCT FROM NEW.order_id
      OR v_transfer_source.order_item_id IS DISTINCT FROM (v_transfer_context->>'source_item_id')::uuid
      OR NEW.order_item_id IS DISTINCT FROM (v_transfer_context->>'new_item_id')::uuid
      OR v_transfer_source.settled_sale_id IS NOT NULL OR NEW.settled_sale_id IS NOT NULL
      OR NEW.sent_quantity<=0 OR NEW.sent_quantity>v_transfer_source.sent_quantity-v_transfer_source.voided_quantity
      OR NEW.voided_quantity<>0 OR NEW.branch_id IS DISTINCT FROM v_transfer_source.branch_id
      OR NEW.warehouse_id IS DISTINCT FROM v_transfer_source.warehouse_id
      OR NEW.created_by IS DISTINCT FROM v_transfer_source.created_by OR NEW.created_at IS DISTINCT FROM v_transfer_source.created_at
      OR NEW.kitchen_send_id IS DISTINCT FROM v_transfer_source.kitchen_send_id
      OR NEW.snapshot_version IS DISTINCT FROM v_transfer_source.snapshot_version
      OR NEW.transfer_origin_event_id IS DISTINCT FROM COALESCE(v_transfer_source.transfer_origin_event_id,v_transfer_source.id)
      OR NEW.total_cost IS DISTINCT FROM round(v_transfer_source.total_cost*NEW.sent_quantity/v_transfer_source.sent_quantity,6)
      OR NEW.component_snapshot IS DISTINCT FROM public._pos_transfer_snapshot_part(v_transfer_source.component_snapshot,NEW.sent_quantity,v_transfer_source.sent_quantity)
      THEN RAISE EXCEPTION 'TRANSFER_SNAPSHOT_PROVENANCE_INVALID'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.snapshot_version < 2
     OR jsonb_typeof(NEW.component_snapshot) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.component_snapshot) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT (component->>'raw_material_id')::uuid)
    INTO v_raw_ids
  FROM jsonb_array_elements(NEW.component_snapshot) component
  WHERE component ? 'raw_material_id';

  BEGIN
    -- Bounded approved sources at this exact send time. Trigger remains paused.
    -- Do not use inventory averages, FIFO batch costs, or default-cost guesses.
    SELECT COALESCE(jsonb_object_agg(
      p.raw_material_id::text,
      jsonb_build_object('unit_cost',p.unit_cost, 'price_source',p.price_source, 'priced_at',p.priced_at)
    ), '{}'::jsonb)
    INTO v_prices
    FROM public._kitchen_approved_price_candidate(NEW.branch_id, v_raw_ids, COALESCE(NEW.created_at, now())) p
    WHERE p.unit_cost > 0
      AND p.price_source IN ('purchase','pricing','stock_count')
      AND p.priced_at IS NOT NULL
      AND p.priced_at <= COALESCE(NEW.created_at, now());
  EXCEPTION WHEN OTHERS THEN
    -- A pricing lookup failure cannot break checkout, kitchen dispatch or stock.
    -- Missing prices remain NULL, never zero and never today's retrospective price.
    v_lookup_failed := true;
    v_prices := '{}'::jsonb;
    RAISE LOG 'kitchen_price_snapshot_lookup_failed event % SQLSTATE %', NEW.id, SQLSTATE;
  END;

  FOR v_component IN SELECT value FROM jsonb_array_elements(NEW.component_snapshot)
  LOOP
    v_price := v_prices -> (v_component->>'raw_material_id');
    v_quantity := NULLIF(v_component->>'quantity','')::numeric;
    v_unit_cost := NULLIF(v_price->>'unit_cost','')::numeric;
    IF v_unit_cost IS NULL OR v_unit_cost <= 0 OR v_quantity IS NULL OR v_quantity <= 0 THEN
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',NULL,
          'extended_cost',NULL,
          'price_source',CASE WHEN v_lookup_failed THEN 'lookup_failed' ELSE 'unpriced' END,
          'priced_at',NULL,
          'price_captured_at',COALESCE(NEW.created_at,now())
        )
      );
    ELSE
      v_components := v_components || jsonb_build_array(
        v_component || jsonb_build_object(
          'unit_cost',v_unit_cost,
          'extended_cost',round(v_quantity*v_unit_cost,6),
          'price_source',v_price->>'price_source',
          'priced_at',v_price->>'priced_at',
          'price_captured_at',COALESCE(NEW.created_at,now())
        )
      );
    END IF;
  END LOOP;

  NEW.component_snapshot := v_components;
  RETURN NEW;
END;
$function$;
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.guard_kitchen_send_operator_ownership()'::regprocedure) NOT IN ('df85fed351dae369b9baec70d5b36fac') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:guard_kitchen_send_operator_ownership'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.guard_kitchen_send_operator_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_partial jsonb;
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

  IF TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.order_item_id);
    IF v_partial IS NOT NULL AND NEW.sent_quantity=COALESCE((SELECT sum(sent_quantity-voided_quantity)
      FROM public.order_kitchen_inventory_events WHERE order_item_id=NEW.order_item_id AND order_id=NEW.order_id),0) THEN
      IF TG_OP='INSERT' AND NEW.order_item_id=(v_partial->>'new_item_id')::uuid
        AND NEW.sent_quantity=(v_partial->>'sent_quantity')::numeric
        AND EXISTS(SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_item_id=(v_partial->>'source_item_id')::uuid
          AND s.branch_id=NEW.branch_id AND s.sent_by IS NOT DISTINCT FROM NEW.sent_by AND s.sent_at=NEW.sent_at) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.order_item_id=(v_partial->>'source_item_id')::uuid
        AND NEW.sent_quantity=OLD.sent_quantity-(v_partial->>'sent_quantity')::numeric
        AND (to_jsonb(NEW)-'sent_quantity')=(to_jsonb(OLD)-'sent_quantity') THEN RETURN NEW;
      END IF;
    END IF;
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
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.guard_pos_operator_ownership()'::regprocedure) NOT IN ('42c828d6844819ca69e808910cbd2f30') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:guard_pos_operator_ownership'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.guard_pos_operator_ownership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_sent_item_void_context boolean:=false;
  v_pos_action_context boolean:=false;
  v_partial jsonb;
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

  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.id);
    IF v_partial IS NOT NULL THEN
      IF TG_OP='INSERT' AND NEW.id=(v_partial->>'new_item_id')::uuid
        AND NEW.quantity=(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=(v_partial->>'bonus')::numeric
        AND NEW.total=(v_partial->>'total')::numeric
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'source_item_id')::uuid
          AND (to_jsonb(i)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])
            =(to_jsonb(NEW)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.id=(v_partial->>'source_item_id')::uuid
        AND OLD.quantity=(v_partial->>'source_quantity')::numeric
        AND NEW.quantity=OLD.quantity-(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=OLD.discount_amount-(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=OLD.bonus_quantity-(v_partial->>'bonus')::numeric
        AND NEW.total=OLD.total-(v_partial->>'total')::numeric
        AND (to_jsonb(NEW)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
          =(to_jsonb(OLD)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'new_item_id')::uuid AND i.order_id=OLD.order_id AND i.quantity=(v_partial->>'quantity')::numeric)
        THEN RETURN NEW;
      END IF;
    END IF;
  END IF;

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

    v_sent_item_void_context :=
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
       AND NOT v_pos_action_context THEN
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

    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      v_item_transfer_context :=
        COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),'')=OLD.order_id::text
        AND COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),'')=NEW.order_id::text
        AND public.can_permission('pos.order.transfer');
    END IF;

    IF v_owner_id IS DISTINCT FROM v_uid
       AND NOT v_can_manage_others
       AND NOT v_item_transfer_context
       AND NOT v_sent_item_void_context THEN
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

    v_sent_item_void_context := EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.table_id = OLD.id
        AND COALESCE(current_setting('app.sent_item_void_order_id',true),'') = o.id::text
        AND public._sent_item_void_context_matches(o.id, NULL)
    );

    IF TG_OP='DELETE' THEN
      IF NOT v_can_manage_others
         AND NOT v_table_item_transfer_context
         AND NOT v_sent_item_void_context
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
         AND NOT v_sent_item_void_context
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
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.guard_sent_order_item_mutation()'::regprocedure) NOT IN ('22549f23df980dcf9345d277d483da9a') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:guard_sent_order_item_mutation'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.guard_sent_order_item_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partial jsonb;
  v_has_sent boolean := false;
  v_is_reduction boolean := false;
  v_internal boolean := COALESCE(current_setting('app.approved_sent_item_void', true), '') = '1';
  v_pending_event_quantity numeric(14,6) := 0;
BEGIN
  SELECT
    EXISTS(
      SELECT 1
      FROM public.order_kitchen_sends s
      WHERE s.order_item_id = OLD.id
    )
    OR EXISTS(
      SELECT 1
      FROM public.order_kitchen_inventory_events e
      WHERE e.order_item_id = OLD.id
        AND e.order_id = OLD.order_id
        AND e.settled_sale_id IS NULL
        AND e.sent_quantity > e.voided_quantity
    )
  INTO v_has_sent;

  IF NOT v_has_sent THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_is_reduction := true;
  ELSIF TG_OP = 'UPDATE'
        AND COALESCE(NEW.quantity, 0) < COALESCE(OLD.quantity, 0) THEN
    v_is_reduction := true;
  END IF;

  IF NOT v_is_reduction THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP='UPDATE' THEN
    v_partial:=public._pos_partial_transfer_context(OLD.order_id,OLD.id);
    IF v_partial IS NOT NULL AND OLD.id=(v_partial->>'source_item_id')::uuid
      AND NEW.quantity=OLD.quantity-(v_partial->>'quantity')::numeric
      AND (to_jsonb(NEW)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
        =(to_jsonb(OLD)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
      AND NEW.quantity>=COALESCE((SELECT sum(sent_quantity-voided_quantity) FROM public.order_kitchen_inventory_events WHERE order_id=OLD.order_id AND order_item_id=OLD.id),0)
      AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'new_item_id')::uuid AND i.quantity=(v_partial->>'quantity')::numeric AND i.order_id=OLD.order_id)
      AND COALESCE((SELECT sum(sent_quantity-voided_quantity) FROM public.order_kitchen_inventory_events WHERE order_id=OLD.order_id AND order_item_id=(v_partial->>'new_item_id')::uuid),0)=(v_partial->>'sent_quantity')::numeric
      THEN RETURN NEW; END IF;
  END IF;

  IF NOT v_internal THEN
    RAISE EXCEPTION 'SENT_ITEM_APPROVAL_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(e.sent_quantity - e.voided_quantity), 0)
  INTO v_pending_event_quantity
  FROM public.order_kitchen_inventory_events e
  WHERE e.order_item_id = OLD.id
    AND e.order_id = OLD.order_id
    AND e.settled_sale_id IS NULL
    AND e.sent_quantity > e.voided_quantity;

  IF TG_OP = 'DELETE' AND v_pending_event_quantity > 0.000001 THEN
    RAISE EXCEPTION 'SENT_ITEM_VOID_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_pending_event_quantity > COALESCE(NEW.quantity, 0) + 0.000001 THEN
    RAISE EXCEPTION 'SENT_ITEM_VOID_INCOMPLETE' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.transfer_order_items_to_table(uuid,uuid[],uuid)'::regprocedure) NOT IN ('b0c4df0d8f3fba4bbf64c5b032b46084') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:transfer_order_items_to_table'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.transfer_order_items_to_table(p_order_id uuid, p_order_item_ids uuid[], p_target_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request jsonb:=NULLIF(current_setting('app.pos_item_transfer_quantity_request',true),'')::jsonb;
  v_operation uuid; v_request_hash text; v_previous public.audit_log%ROWTYPE; v_result jsonb;
  v_requested_ids uuid[]; v_move_ids uuid[]:='{}'; v_moves jsonb:='[]'; v_line record; v_spec jsonb; v_take numeric; v_available numeric; v_new_id uuid; v_branch_hint uuid;
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

  IF v_request IS NOT NULL THEN
    IF jsonb_typeof(v_request)<>'object' OR jsonb_typeof(v_request->'quantities') IS DISTINCT FROM 'array'
      OR NULLIF(v_request->>'operation_id','') IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
    v_operation:=(v_request->>'operation_id')::uuid;
    v_request_hash:=md5(jsonb_build_object('source',p_order_id,'target',p_target_table_id,'ids',to_jsonb(p_order_item_ids),'request',v_request)::text);
    SELECT branch_id INTO v_branch_hint FROM public.orders WHERE id=p_order_id;
    IF v_branch_hint IS NULL OR NOT public.user_may_access_branch(v_branch_hint) THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND'); END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('pos-quantity-transfer:'||v_branch_hint::text,0)) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_BUSY'); END IF;
  END IF;

  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id=p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;
  IF NOT public.user_may_access_branch(v_order.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','BRANCH_MISMATCH');
  END IF;
  IF v_operation IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.audit_log WHERE id=v_operation;
    IF FOUND THEN
      IF v_previous.user_id IS DISTINCT FROM v_uid OR v_previous.branch_id IS DISTINCT FROM v_order.branch_id
        OR v_previous.entity_id IS DISTINCT FROM p_order_id OR v_previous.action<>'ORDER_ITEMS_TABLE_TRANSFERRED'
        OR v_previous.details->>'transfer_request_hash' IS DISTINCT FROM v_request_hash THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_OPERATION_CONFLICT'); END IF;
      RETURN (v_previous.details->'result')||jsonb_build_object('replayed',true,'snapshot',public._pos_transfer_pair_snapshot(p_order_id,(v_previous.details->>'target_order_id')::uuid));
    END IF;
  END IF;
  IF v_order.status NOT IN ('open','held') THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE'); END IF;

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

  v_requested_ids:=v_item_ids;
  IF v_request IS NOT NULL THEN
    IF jsonb_array_length(v_request->'quantities')<>v_requested_count
      OR (SELECT count(DISTINCT value->>'order_item_id') FROM jsonb_array_elements(v_request->'quantities'))<>v_requested_count THEN
      RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
    FOR v_line IN SELECT * FROM public.order_items WHERE order_id=p_order_id AND id=ANY(v_item_ids) ORDER BY id LOOP
      SELECT value INTO v_spec FROM jsonb_array_elements(v_request->'quantities') WHERE value->>'order_item_id'=v_line.id::text;
      IF v_spec IS NULL OR jsonb_typeof(v_spec->'expected') IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
      v_take:=(v_spec->>'quantity')::numeric;
      IF v_take IS NULL OR v_take<=0 OR round(v_take,4)<>v_take OR v_take::text IN ('NaN','Infinity','-Infinity') THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_QUANTITY'); END IF;
      IF v_spec->'expected' IS DISTINCT FROM jsonb_build_object('quantity',v_line.quantity,'product_id',v_line.product_id,'unit_name',v_line.unit_name,
        'unit_price',v_line.unit_price,'discount_amount',v_line.discount_amount,'bonus_quantity',v_line.bonus_quantity,'notes',COALESCE(v_line.notes,''),
        'modifier_option_ids',COALESCE(to_jsonb(v_line.modifier_option_ids),'[]'::jsonb)) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_SOURCE_CHANGED'); END IF;
      SELECT v_line.quantity-COALESCE(sum(sent_quantity-voided_quantity) FILTER(WHERE settled_sale_id IS NOT NULL),0) INTO v_available
        FROM public.order_kitchen_inventory_events WHERE order_id=p_order_id AND order_item_id=v_line.id;
      IF v_take>v_available THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_QUANTITY_UNAVAILABLE','available_quantity',v_available,'order_item_id',v_line.id); END IF;
    END LOOP;
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

  IF v_request IS NOT NULL AND (EXISTS(SELECT 1 FROM public.order_kitchen_inventory_events WHERE order_id IN(p_order_id,v_target_order_id) AND settled_sale_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.orders WHERE id IN(p_order_id,v_target_order_id) AND payment_status IN ('partial','paid'))) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_PAID_ORDER_REQUIRES_SETTLEMENT'); END IF;

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

  IF v_request IS NOT NULL THEN
    FOR v_line IN SELECT * FROM public.order_items WHERE order_id=p_order_id AND id=ANY(v_requested_ids) ORDER BY id LOOP
      SELECT value INTO v_spec FROM jsonb_array_elements(v_request->'quantities') WHERE value->>'order_item_id'=v_line.id::text;
      v_take:=(v_spec->>'quantity')::numeric;
      v_new_id:=CASE WHEN v_take=v_line.quantity THEN v_line.id ELSE public._pos_split_transfer_line(p_order_id,v_line.id,v_take,v_target_order_id) END;
      v_move_ids:=array_append(v_move_ids,v_new_id);
      v_moves:=v_moves||jsonb_build_array(jsonb_build_object('source_item_id',v_line.id,'moved_item_id',v_new_id,'quantity',v_take));
    END LOOP;
    v_item_ids:=v_move_ids;
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

  IF v_request IS NOT NULL THEN
    UPDATE public.order_kitchen_served_quantities SET order_id=v_target_order_id WHERE order_id=p_order_id AND order_item_id=ANY(v_item_ids);
  END IF;

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
          WHEN v_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends oks LEFT JOIN public.order_kitchen_served_quantities ksb ON ksb.order_id=oks.order_id AND ksb.order_item_id=oks.order_item_id WHERE oks.order_id=v_target_order_id AND oks.sent_quantity>COALESCE(ksb.served_quantity,0)) THEN 'served'
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

  v_result:=jsonb_build_object(
    'success',true,
    'source_order_id',p_order_id,
    'target_order_id',v_target_order_id,
    'target_order_number',v_target_order_number,
    'moved_item_count',v_requested_count,'quantity_transfers',v_moves,
    'moved_sent_item_count',v_moved_sent_count,
    'target_owner_id',v_target_owner_id,
    'source_order_empty',v_remaining=0,
    'inventory_changed',false,
    'kds_reassigned',v_moved_sent_count>0,
    'kds_resent',false
  );

  INSERT INTO public.audit_log(id,user_id,action,entity,entity_id,details,branch_id)
  VALUES(
    COALESCE(v_operation,gen_random_uuid()),
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
      'kds_resent',false,'quantity_transfers',v_moves,'transfer_request_hash',v_request_hash,'result',v_result
    ),
    v_order.branch_id
  );

  RETURN CASE WHEN v_request IS NOT NULL THEN v_result||jsonb_build_object('snapshot',public._pos_transfer_pair_snapshot(p_order_id,v_target_order_id)) ELSE v_result END;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'error','TRANSACTION_FAILED','detail',SQLERRM);
END;
$function$;
DO $lineage$
DECLARE v_def text; v_body text;
BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO v_def,v_body FROM pg_proc WHERE oid='public._restore_kitchen_inventory_for_void(uuid,uuid,numeric)'::regprocedure;
 IF md5(replace(v_body,chr(13),'')) NOT IN ('5fc946d3f2c10042d93926a9b23ead30','72da7142c0b1eff13aa7200a0a40230f') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:_restore_kitchen_inventory_for_void'; END IF;
 IF (SELECT count(*) FROM regexp_matches(v_def,$needle$'kitchen_send',\s+v_event.id,\s+v_effect.target_id,$needle$,'g'))<>1 THEN RAISE EXCEPTION 'TRANSFER_LINEAGE_FRAGMENT_DRIFT'; END IF;
 EXECUTE regexp_replace(v_def,$needle$'kitchen_send',\s+v_event.id,\s+v_effect.target_id,$needle$,$replacement$'kitchen_send',
          COALESCE(v_event.transfer_origin_event_id,v_event.id),
          v_effect.target_id,$replacement$);
END $lineage$;
DO $lineage$
DECLARE v_def text; v_body text;
BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO v_def,v_body FROM pg_proc WHERE oid='public._restore_refund_hybrid_inventory(uuid,uuid,uuid,numeric,uuid,uuid,text)'::regprocedure;
 IF md5(replace(v_body,chr(13),'')) NOT IN ('dfb51bb1e41fb2144edeec01225e9744','0511c763a9243024d58571b34dcaedfb') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:_restore_refund_hybrid_inventory'; END IF;
 IF (SELECT count(*) FROM regexp_matches(v_def,$needle$SELECT id,warehouse_id$needle$,'g'))<>1 THEN RAISE EXCEPTION 'TRANSFER_LINEAGE_FRAGMENT_DRIFT'; END IF;
 EXECUTE regexp_replace(v_def,$needle$SELECT id,warehouse_id$needle$,$replacement$SELECT COALESCE(transfer_origin_event_id,id) AS id,warehouse_id$replacement$);
END $lineage$;
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public._reprice_order_item()'::regprocedure) NOT IN ('3b74510399a79c3028863f0620a95c1f','3753587c8bd3ebff1469df445a7f1e02') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:_reprice_order_item'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public._reprice_order_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_partial jsonb; v_branch_id uuid; v_base_price numeric(14,2); v_mod jsonb;
BEGIN
  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.id);
    IF v_partial IS NOT NULL THEN
      IF TG_OP='INSERT' AND NEW.id=(v_partial->>'new_item_id')::uuid
        AND NEW.quantity=(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=(v_partial->>'bonus')::numeric
        AND NEW.total=(v_partial->>'total')::numeric
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'source_item_id')::uuid
          AND (to_jsonb(i)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])
            =(to_jsonb(NEW)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.id=(v_partial->>'source_item_id')::uuid
        AND OLD.quantity=(v_partial->>'source_quantity')::numeric
        AND NEW.quantity=OLD.quantity-(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=OLD.discount_amount-(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=OLD.bonus_quantity-(v_partial->>'bonus')::numeric
        AND NEW.total=OLD.total-(v_partial->>'total')::numeric
        AND (to_jsonb(NEW)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
          =(to_jsonb(OLD)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'new_item_id')::uuid AND i.order_id=OLD.order_id AND i.quantity=(v_partial->>'quantity')::numeric)
        THEN RETURN NEW;
      END IF;
    END IF;
  END IF;

  SELECT o.branch_id INTO v_branch_id FROM public.orders o WHERE o.id=NEW.order_id;
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  SELECT p.sale_price INTO v_base_price FROM public.products p WHERE p.id=NEW.product_id AND p.branch_id=v_branch_id AND p.is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_IN_BRANCH'; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity<=0 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  v_mod:=public.resolve_product_modifiers(NEW.product_id,v_branch_id,to_jsonb(COALESCE(NEW.modifier_option_ids,'{}'::uuid[])));
  IF COALESCE((v_mod->>'success')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MODIFIER_VALIDATION_FAILED: %',COALESCE(v_mod->>'error','unknown'); END IF;
  NEW.modifiers_snapshot:=COALESCE(v_mod->'snapshot','[]'::jsonb);
  NEW.unit_price:=ROUND(GREATEST(COALESCE(v_base_price,0)+COALESCE((v_mod->>'price_delta')::numeric,0),0),2);
  NEW.discount_amount:=ROUND(LEAST(GREATEST(COALESCE(NEW.discount_amount,0),0),NEW.quantity*NEW.unit_price),2);
  NEW.bonus_quantity:=GREATEST(COALESCE(NEW.bonus_quantity,0),0);
  NEW.total:=ROUND(NEW.quantity*NEW.unit_price-NEW.discount_amount,2);
  RETURN NEW;
END;
$function$;
DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.enforce_pos_permission_mutation()'::regprocedure) NOT IN ('9e6234bbeda10d4e2546d8c5db1106be') THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:enforce_pos_permission_mutation'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.enforce_pos_permission_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service_role boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_print_only_mutation boolean := false;
  v_item_transfer_context boolean := false;
  v_sent_item_void_context boolean := false;
  v_pos_action_context boolean := false;
  v_partial jsonb;
BEGIN
  IF v_is_service_role OR v_uid IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.id);
    IF v_partial IS NOT NULL THEN
      IF TG_OP='INSERT' AND NEW.id=(v_partial->>'new_item_id')::uuid
        AND NEW.quantity=(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=(v_partial->>'bonus')::numeric
        AND NEW.total=(v_partial->>'total')::numeric
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'source_item_id')::uuid
          AND (to_jsonb(i)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])
            =(to_jsonb(NEW)-ARRAY['id','quantity','discount_amount','bonus_quantity','total'])) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.id=(v_partial->>'source_item_id')::uuid
        AND OLD.quantity=(v_partial->>'source_quantity')::numeric
        AND NEW.quantity=OLD.quantity-(v_partial->>'quantity')::numeric
        AND NEW.discount_amount=OLD.discount_amount-(v_partial->>'discount')::numeric
        AND NEW.bonus_quantity=OLD.bonus_quantity-(v_partial->>'bonus')::numeric
        AND NEW.total=OLD.total-(v_partial->>'total')::numeric
        AND (to_jsonb(NEW)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
          =(to_jsonb(OLD)-ARRAY['quantity','discount_amount','bonus_quantity','total'])
        AND EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=(v_partial->>'new_item_id')::uuid AND i.order_id=OLD.order_id AND i.quantity=(v_partial->>'quantity')::numeric)
        THEN RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME='order_kitchen_sends' THEN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    v_partial:=public._pos_partial_transfer_context(NEW.order_id,NEW.order_item_id);
    IF v_partial IS NOT NULL AND NEW.sent_quantity=COALESCE((SELECT sum(sent_quantity-voided_quantity)
      FROM public.order_kitchen_inventory_events WHERE order_item_id=NEW.order_item_id AND order_id=NEW.order_id),0) THEN
      IF TG_OP='INSERT' AND NEW.order_item_id=(v_partial->>'new_item_id')::uuid
        AND NEW.sent_quantity=(v_partial->>'sent_quantity')::numeric
        AND EXISTS(SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_item_id=(v_partial->>'source_item_id')::uuid
          AND s.branch_id=NEW.branch_id AND s.sent_by IS NOT DISTINCT FROM NEW.sent_by AND s.sent_at=NEW.sent_at) THEN RETURN NEW;
      ELSIF TG_OP='UPDATE' AND NEW.order_item_id=(v_partial->>'source_item_id')::uuid
        AND NEW.sent_quantity=OLD.sent_quantity-(v_partial->>'sent_quantity')::numeric
        AND (to_jsonb(NEW)-'sent_quantity')=(to_jsonb(OLD)-'sent_quantity') THEN RETURN NEW;
      END IF;
    END IF;
  END IF;

  END IF;
  IF TG_TABLE_NAME='orders' THEN
  IF TG_OP='UPDATE'
    AND public.can_permission('pos.order.transfer') AND public.user_may_access_branch(OLD.branch_id)
    AND COALESCE(current_setting('app.pos_item_transfer_branch_id',true),'')=OLD.branch_id::text
    AND OLD.id::text IN (COALESCE(current_setting('app.pos_item_transfer_source_order_id',true),''),COALESCE(current_setting('app.pos_item_transfer_target_order_id',true),''))
    AND (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at'])=(to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at'])
    AND (
      (NEW.kitchen_status='pending' AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends WHERE order_id=OLD.id AND sent_quantity>0))
      OR (NEW.kitchen_status='sent' AND EXISTS(SELECT 1 FROM public.order_kitchen_sends WHERE order_id=OLD.id AND sent_quantity>0))
      OR (NEW.kitchen_status='served' AND EXISTS(SELECT 1 FROM public.order_kitchen_sends WHERE order_id=OLD.id AND sent_quantity>0)
        AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends oks LEFT JOIN public.order_kitchen_served_quantities ksb ON ksb.order_id=oks.order_id AND ksb.order_item_id=oks.order_item_id
          WHERE oks.order_id=OLD.id AND oks.sent_quantity>COALESCE(ksb.served_quantity,0)))
    ) THEN RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME='sales' THEN
    IF TG_OP='INSERT' AND NOT public.can_permission('pos.payment.take') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='order_kitchen_sends' THEN
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(
        CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END,
        CASE WHEN TG_OP='DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END
      );
    IF NOT public.can_permission('pos.send_kitchen')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.send_kitchen';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME='orders' THEN
    IF TG_OP='INSERT' THEN
      IF NOT public.can_permission('pos.order.create') AND NOT (public.can_permission('pos.order.quick_create') AND COALESCE(NEW.order_type='takeaway' AND NEW.table_id IS NULL AND NEW.status='open' AND (COALESCE(NEW.discount_amount,0)=0 OR public.can_permission('pos.discount')) AND NEW.cashier_id=auth.uid() AND public.user_may_access_branch(NEW.branch_id),false)) THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.create'; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.cancel_order') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order'; END IF;
      RETURN OLD;
    END IF;

    IF pg_trigger_depth()>1
       AND public.can_permission('pos.order.quick_create')
       AND OLD.order_type='takeaway' AND OLD.table_id IS NULL
       AND OLD.cashier_id=auth.uid() AND OLD.status='open'
       AND OLD.created_at>=transaction_timestamp()
       AND public.user_may_access_branch(OLD.branch_id)
       AND (to_jsonb(NEW)-ARRAY['subtotal','discount_amount','tax_amount','total','updated_at']::text[])
         = (to_jsonb(OLD)-ARRAY['subtotal','discount_amount','tax_amount','total','updated_at']::text[]) THEN
      RETURN NEW;
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

      -- A served order may receive later additions. This is still a
      -- send-to-kitchen transition, not broad KDS management. Allow it only
      -- when an authoritative served baseline exists and cumulative sent
      -- quantity now exceeds that baseline for at least one line.
      IF OLD.kitchen_status='served'
         AND NEW.kitchen_status='sent'
         AND public.can_permission('pos.send_kitchen')
         AND EXISTS(
           SELECT 1 FROM public.order_kitchen_served_quantities baseline
           WHERE baseline.order_id = OLD.id
         )
         AND EXISTS(
           SELECT 1
           FROM public.order_kitchen_sends s
           LEFT JOIN public.order_kitchen_served_quantities ksb
             ON ksb.order_id = OLD.id
            AND ksb.order_item_id = s.order_item_id
           WHERE s.order_id = OLD.id
             AND COALESCE(s.sent_quantity,0) > COALESCE(ksb.served_quantity,0)
         ) THEN
        RETURN NEW;
      END IF;
      IF NOT public.can_permission('pos.kds_update') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.kds_update'; END IF;
      RETURN NEW;
    END IF;

    -- A repeated authorized KDS status is still kitchen bookkeeping, not order editing.
    -- Restrict the exception to this order's branch/station and kitchen fields.
    IF NEW.kitchen_status IS NOT DISTINCT FROM OLD.kitchen_status
       AND (to_jsonb(NEW)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[])
         = (to_jsonb(OLD)-ARRAY['kitchen_status','kitchen_sent_at','kitchen_ready_at','updated_at']::text[])
       AND public.can_permission('pos.kds_update')
       AND public.user_may_access_branch(OLD.branch_id)
       AND public.kds_order_in_user_station_scope(OLD.id) THEN
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
        )
        -- A signed sent-item Void may structurally close its own now-empty order.
        -- This does not grant the caller generic pos.cancel_order authority.
        AND NOT public._sent_item_void_context_matches(OLD.id,NULL) THEN
          RAISE EXCEPTION 'PERMISSION_DENIED:pos.cancel_order';
        END IF;
      ELSIF NEW.status='completed' THEN
        IF NOT public.can_permission('pos.payment.take') THEN RAISE EXCEPTION 'PERMISSION_DENIED:pos.payment.take'; END IF;
        v_pos_action_context :=
          public._pos_action_context_matches(OLD.id,'pos.payment.take');
        IF NOT public.can_permission('pos.order.edit')
           AND NOT v_pos_action_context
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

    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.id, NULL);

    v_pos_action_context :=
      public._pos_action_context_matches(OLD.id,'pos.payment.take')
      OR public._pos_action_context_matches(OLD.id,'pos.send_kitchen')
      OR public._pos_action_context_matches(OLD.id,'pos.cancel_order');

    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context
       AND NOT v_pos_action_context THEN
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
      IF NOT public.can_permission('pos.order.create') AND NOT public.can_permission('pos.order.edit') AND NOT (public.can_permission('pos.order.quick_create') AND (public.can_permission('pos.discount') OR (COALESCE(NEW.discount_amount,0)=0 AND COALESCE(NEW.bonus_quantity,0)=0)) AND EXISTS(SELECT 1 FROM public.orders qo WHERE qo.id=NEW.order_id AND qo.order_type='takeaway' AND qo.table_id IS NULL AND qo.cashier_id=auth.uid() AND qo.status='open' AND qo.created_at>=transaction_timestamp() AND public.user_may_access_branch(qo.branch_id))) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
      END IF;
      RETURN NEW;
    END IF;
    v_sent_item_void_context :=
      public._sent_item_void_context_matches(OLD.order_id, OLD.id);

    IF TG_OP='DELETE' THEN
      IF NOT public.can_permission('pos.void')
         AND NOT v_sent_item_void_context THEN
        RAISE EXCEPTION 'PERMISSION_DENIED:pos.void';
      END IF;
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
    ELSIF NOT public.can_permission('pos.order.edit')
       AND NOT v_sent_item_void_context THEN
      RAISE EXCEPTION 'PERMISSION_DENIED:pos.order.edit';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
NOTIFY pgrst, 'reload schema';
COMMIT;
