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
