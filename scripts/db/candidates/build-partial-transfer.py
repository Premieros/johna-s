from pathlib import Path
import json,hashlib,re
root=Path(__file__).parent
rows=json.loads((root/'partial_transfer_baseline.json').read_text())+json.loads((root/'partial_transfer_extra_baseline.json').read_text())
by={r['proname']:r for r in rows if r['proname']!='_restore_refund_hybrid_inventory' or r['args'].startswith('p_sale_item_id')}
patched={}
def rep(s,a,b,n=1):
 assert s.count(a)==n,(a[:100],s.count(a),n)
 return s.replace(a,b)
s=by['guard_pos_operator_ownership']['definition'];s=rep(s,'  v_pos_action_context boolean:=false;','  v_pos_action_context boolean:=false;\n  v_partial jsonb;')
point="  IF TG_TABLE_NAME='orders' THEN"
block="""  IF TG_TABLE_NAME='order_items' AND TG_OP IN ('INSERT','UPDATE') THEN
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

"""
s=rep(s,point,block+point);patched['guard_pos_operator_ownership']=s
item_block=block
s=by['_reprice_order_item']['definition'];s=rep(s,'DECLARE v_branch_id uuid;', 'DECLARE v_partial jsonb; v_branch_id uuid;');s=rep(s,'BEGIN\n','BEGIN\n'+item_block);patched['_reprice_order_item']=s
s=by['guard_kitchen_send_operator_ownership']['definition'];s=rep(s,'  v_send_action_authorized boolean:=false;', '  v_send_action_authorized boolean:=false;\n  v_partial jsonb;')
point="  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN"
block="""  IF TG_OP IN ('INSERT','UPDATE') THEN
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

"""
s=rep(s,point,block+point);patched['guard_kitchen_send_operator_ownership']=s
kitchen_block=block
# Keep original permission rules outside the exact structural allocation.
s=by['enforce_pos_permission_mutation']['definition'];s=rep(s,'  v_pos_action_context boolean := false;', '  v_pos_action_context boolean := false;\n  v_partial jsonb;')
point="  IF TG_TABLE_NAME='sales' THEN"
orders_block="""  IF TG_TABLE_NAME='orders' THEN
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

"""
# Kitchen-specific row records must only be inspected on that trigger table.
s=rep(s,point,item_block+"  IF TG_TABLE_NAME='order_kitchen_sends' THEN\n"+kitchen_block+"  END IF;\n"+orders_block+point);patched['enforce_pos_permission_mutation']=s
s=by['guard_sent_order_item_mutation']['definition'];s=rep(s,'  v_has_sent boolean := false;','  v_partial jsonb;\n  v_has_sent boolean := false;')
point='  IF NOT v_internal THEN'
block="""  IF TG_OP='UPDATE' THEN
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

"""
s=rep(s,point,block+point);patched['guard_sent_order_item_mutation']=s
s=by['_capture_kitchen_ingredient_prices']['definition'];s=rep(s,'  v_raw_ids uuid[];','  v_transfer_source public.order_kitchen_inventory_events%ROWTYPE;\n  v_transfer_context jsonb;\n  v_raw_ids uuid[];')
point='  IF NEW.snapshot_version < 2'
block="""  IF NEW.transfer_origin_event_id IS NOT NULL THEN
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

"""
s=rep(s,point,block+point);patched['_capture_kitchen_ingredient_prices']=s
# Legacy unit reversals keep the original consumption-entry identity. Raw v2
# reversals continue using each event's conserved frozen component snapshot.
s=by['_restore_kitchen_inventory_for_void']['definition'];s=rep(s,"          'kitchen_send',\n          v_event.id,\n          v_effect.target_id,", "          'kitchen_send',\n          COALESCE(v_event.transfer_origin_event_id,v_event.id),\n          v_effect.target_id,");patched['_restore_kitchen_inventory_for_void']=s
s=by['_restore_refund_hybrid_inventory']['definition'];s=rep(s,'            SELECT id,warehouse_id\n', '            SELECT COALESCE(transfer_origin_event_id,id) AS id,warehouse_id\n');patched['_restore_refund_hybrid_inventory']=s
s=by['transfer_order_items_to_table']['definition']
s=rep(s,'  v_uid uuid := auth.uid();',"""  v_request jsonb:=NULLIF(current_setting('app.pos_item_transfer_quantity_request',true),'')::jsonb;
  v_operation uuid; v_request_hash text; v_previous public.audit_log%ROWTYPE; v_result jsonb;
  v_requested_ids uuid[]; v_move_ids uuid[]:='{}'; v_moves jsonb:='[]'; v_line record; v_spec jsonb; v_take numeric; v_available numeric; v_new_id uuid; v_branch_hint uuid;
  v_uid uuid := auth.uid();""")
point='  SELECT * INTO v_order\n'
block="""  IF v_request IS NOT NULL THEN
    IF jsonb_typeof(v_request)<>'object' OR jsonb_typeof(v_request->'quantities') IS DISTINCT FROM 'array'
      OR NULLIF(v_request->>'operation_id','') IS NULL THEN RETURN jsonb_build_object('success',false,'error','INVALID_TRANSFER_REQUEST'); END IF;
    v_operation:=(v_request->>'operation_id')::uuid;
    v_request_hash:=md5(jsonb_build_object('source',p_order_id,'target',p_target_table_id,'ids',to_jsonb(p_order_item_ids),'request',v_request)::text);
    SELECT branch_id INTO v_branch_hint FROM public.orders WHERE id=p_order_id;
    IF v_branch_hint IS NULL OR NOT public.user_may_access_branch(v_branch_hint) THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND'); END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('pos-quantity-transfer:'||v_branch_hint::text,0)) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_BUSY'); END IF;
  END IF;

"""
s=rep(s,point,block+point)
s=rep(s,"  WHERE o.id=p_order_id AND o.status IN ('open','held')",'  WHERE o.id=p_order_id')
point="  IF v_order.order_type <> 'dine_in' OR v_order.table_id IS NULL THEN"
block="""  IF v_operation IS NOT NULL THEN
    SELECT * INTO v_previous FROM public.audit_log WHERE id=v_operation;
    IF FOUND THEN
      IF v_previous.user_id IS DISTINCT FROM v_uid OR v_previous.branch_id IS DISTINCT FROM v_order.branch_id
        OR v_previous.entity_id IS DISTINCT FROM p_order_id OR v_previous.action<>'ORDER_ITEMS_TABLE_TRANSFERRED'
        OR v_previous.details->>'transfer_request_hash' IS DISTINCT FROM v_request_hash THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_OPERATION_CONFLICT'); END IF;
      RETURN (v_previous.details->'result')||jsonb_build_object('replayed',true,'snapshot',public._pos_transfer_pair_snapshot(p_order_id,(v_previous.details->>'target_order_id')::uuid));
    END IF;
  END IF;
  IF v_order.status NOT IN ('open','held') THEN RETURN jsonb_build_object('success',false,'error','ORDER_NOT_EDITABLE'); END IF;

"""
s=rep(s,point,block+point)
point='  SELECT * INTO v_target\n'
block="""  v_requested_ids:=v_item_ids;
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

"""
s=rep(s,point,block+point)
# A paid destination's historical discount allocation must not be redistributed.
# Do not infer a new financial history for partially settled orders.
s=rep(s,"  IF v_target_order_id IS NULL THEN", "  IF v_request IS NOT NULL AND (EXISTS(SELECT 1 FROM public.order_kitchen_inventory_events WHERE order_id IN(p_order_id,v_target_order_id) AND settled_sale_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.orders WHERE id IN(p_order_id,v_target_order_id) AND payment_status IN ('partial','paid'))) THEN RETURN jsonb_build_object('success',false,'error','TRANSFER_PAID_ORDER_REQUIRES_SETTLEMENT'); END IF;\n\n  IF v_target_order_id IS NULL THEN")
point='  SELECT COALESCE(sum(COALESCE(oi.total,oi.quantity*oi.unit_price)),0)\n  INTO v_source_line_subtotal'
block="""  IF v_request IS NOT NULL THEN
    FOR v_line IN SELECT * FROM public.order_items WHERE order_id=p_order_id AND id=ANY(v_requested_ids) ORDER BY id LOOP
      SELECT value INTO v_spec FROM jsonb_array_elements(v_request->'quantities') WHERE value->>'order_item_id'=v_line.id::text;
      v_take:=(v_spec->>'quantity')::numeric;
      v_new_id:=CASE WHEN v_take=v_line.quantity THEN v_line.id ELSE public._pos_split_transfer_line(p_order_id,v_line.id,v_take,v_target_order_id) END;
      v_move_ids:=array_append(v_move_ids,v_new_id);
      v_moves:=v_moves||jsonb_build_array(jsonb_build_object('source_item_id',v_line.id,'moved_item_id',v_new_id,'quantity',v_take));
    END LOOP;
    v_item_ids:=v_move_ids;
  END IF;

"""
s=rep(s,point,block+point)
s=rep(s,"    AND order_id=p_order_id;\n\n  SELECT round", "    AND order_id=p_order_id;\n\n  IF v_request IS NOT NULL THEN\n    UPDATE public.order_kitchen_served_quantities SET order_id=v_target_order_id WHERE order_id=p_order_id AND order_item_id=ANY(v_item_ids);\n  END IF;\n\n  SELECT round")
s=rep(s,"          WHEN kitchen_status IN ('sent','cooking','ready') THEN kitchen_status", "          WHEN v_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_kitchen_sends oks LEFT JOIN public.order_kitchen_served_quantities ksb ON ksb.order_id=oks.order_id AND ksb.order_item_id=oks.order_item_id WHERE oks.order_id=v_target_order_id AND oks.sent_quantity>COALESCE(ksb.served_quantity,0)) THEN 'served'\n          WHEN kitchen_status IN ('sent','cooking','ready') THEN kitchen_status")
# Build one result before writing the existing audit receipt. Its primary UUID
# becomes the idempotency key, requiring no new table/index/history scan.
retstart=s.index('  RETURN jsonb_build_object(\n    \'success\',true,\n    \'source_order_id\'')
retend=s.index('\nEXCEPTION WHEN OTHERS',retstart)
ret=s[retstart:retend];result_assignment=ret.replace('  RETURN jsonb_build_object(', '  v_result:=jsonb_build_object(',1)
insertpoint='  INSERT INTO public.audit_log(user_id,action,entity,entity_id,details,branch_id)'
s=rep(s,insertpoint,result_assignment+'\n\n'+insertpoint)
s=rep(s,insertpoint,'  INSERT INTO public.audit_log(id,user_id,action,entity,entity_id,details,branch_id)')
s=rep(s,"  VALUES(\n    v_uid,\n    'ORDER_ITEMS_TABLE_TRANSFERRED',", "  VALUES(\n    COALESCE(v_operation,gen_random_uuid()),\n    v_uid,\n    'ORDER_ITEMS_TABLE_TRANSFERRED',")
s=rep(s,"      'kds_resent',false\n    ),", "      'kds_resent',false,'quantity_transfers',v_moves,'transfer_request_hash',v_request_hash,'result',v_result\n    ),")
s=rep(s,ret,"  RETURN CASE WHEN v_request IS NOT NULL THEN v_result||jsonb_build_object('snapshot',public._pos_transfer_pair_snapshot(p_order_id,v_target_order_id)) ELSE v_result END;")
s=rep(s,"    'moved_item_count',v_requested_count,\n    'moved_sent_item_count'","    'moved_item_count',v_requested_count,'quantity_transfers',v_moves,\n    'moved_sent_item_count'")
patched['transfer_order_items_to_table']=s
# Guard exactly the captured definitions; preserve original ACL, security mode,
# signatures and search paths. No existing privileged helper is broadened.
by.pop('_restore_refund_hybrid_inventory',None)
def sig(r):return r['proname']+'('+','.join(a.strip().split()[1] for a in r['args'].split(',')) +')' if r['args'] else r['proname']+'()'
def guard(r):
 body=r['definition'].split('AS $function$')[1].split('$function$')[0].replace('\r','')
 hashes=[hashlib.md5(body.encode()).hexdigest()]
 if r['proname']=='_reprice_order_item' and r['definition']==by['_reprice_order_item']['definition']:
  canonical=Path('supabase/migrations/20260902141000_fix_order_modifier_authoritative_pricing.sql').read_text()
  canonical_body=re.search(r'AS \$\$(.*?)\$\$;',canonical,re.S).group(1)
  hashes.append(hashlib.md5(canonical_body.encode()).hexdigest())
 return "DO $guard$ BEGIN IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.%s'::regprocedure) NOT IN (%s) THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:%s'; END IF; END $guard$;\n"%(sig(r),','.join("'%s'"%h for h in hashes),r['proname'])

# Production retains the legacy reversal implementation; clean canonical replay
# retains the later v2 snapshot implementation. Patch only the lineage reference
# in either exact known body, preserving its existing restoration strategy.
canonical_reversals={}
reversal_source=Path('supabase/migrations/20260923073000_snapshot_void_refund_reversal.sql').read_text()
paid_source=Path('supabase/migrations/20261002194500_paid_order_reopen_guard.sql').read_text()
for name in ['_restore_kitchen_inventory_for_void','_restore_refund_hybrid_inventory']:
 definition=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\([\s\S]*?\$function\$;',reversal_source).group(0)
 if name=='_restore_kitchen_inventory_for_void':
  old=re.search(r'v_old := \$old\$(.*?)\$old\$;',paid_source,re.S).group(1)
  new=re.search(r'v_new := \$new\$(.*?)\$new\$;',paid_source,re.S).group(1)
  definition=rep(definition,old,new)
 original=next(r for r in rows if r['proname']==name and (name!='_restore_refund_hybrid_inventory' or r['args'].startswith('p_sale_item_id')))
 canonical_reversals[name]=dict(original,definition=definition)
(root/'partial_transfer_canonical_reversal_baseline.json').write_text(json.dumps(list(canonical_reversals.values()),indent=2)+'\n')

def lineage_patch(r):
 name=r['proname'];known=[r,canonical_reversals[name]]
 hashes=[hashlib.md5(x['definition'].split('AS $function$')[1].split('$function$')[0].encode()).hexdigest() for x in known]
 if name=='_restore_kitchen_inventory_for_void':
  needle="'kitchen_send',\\s+v_event.id,\\s+v_effect.target_id,"
  replacement="'kitchen_send',\n          COALESCE(v_event.transfer_origin_event_id,v_event.id),\n          v_effect.target_id,"
 else:
  needle='SELECT id,warehouse_id'
  replacement='SELECT COALESCE(transfer_origin_event_id,id) AS id,warehouse_id'
 return """DO $lineage$
DECLARE v_def text; v_body text;
BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO v_def,v_body FROM pg_proc WHERE oid='public.%s'::regprocedure;
 IF md5(replace(v_body,chr(13),'')) NOT IN (%s) THEN RAISE EXCEPTION 'PARTIAL_TRANSFER_SOURCE_DRIFT:%s'; END IF;
 IF (SELECT count(*) FROM regexp_matches(v_def,$needle$%s$needle$,'g'))<>1 THEN RAISE EXCEPTION 'TRANSFER_LINEAGE_FRAGMENT_DRIFT'; END IF;
 EXECUTE regexp_replace(v_def,$needle$%s$needle$,$replacement$%s$replacement$);
END $lineage$;
"""%(sig(r),','.join("'%s'"%h for h in hashes),name,needle,needle,replacement)

selected=[]
for r in rows:
 if r['proname'] not in patched:continue
 if r['proname']=='_restore_refund_hybrid_inventory' and not r['args'].startswith('p_sale_item_id'):continue
 selected.append(r)
migration=next(Path('supabase/migrations').glob('*_partial_item_table_transfer.sql'))
text="BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\n"+(root/'partial_transfer_helpers.sql').read_text()+'\n'
for r in selected:
 if r['proname'] in canonical_reversals:text+=lineage_patch(r)
 else:text+=guard(r)+patched[r['proname']].rstrip().rstrip(';')+';\n'
migration.write_text(text+'COMMIT;\n')


# Operational rollback deliberately retains lineage-aware reversals for committed transfers.
rollback_dir=Path('scripts/rollback');rollback_dir.mkdir(exist_ok=True)
canonical=patched['transfer_order_items_to_table']
disabled=rep(canonical,"  IF v_order.status NOT IN ('open','held') THEN", "  IF v_request IS NOT NULL THEN RETURN jsonb_build_object('success',false,'error','PARTIAL_TRANSFER_DISABLED'); END IF;\n  IF v_order.status NOT IN ('open','held') THEN")
row=next(r for r in rows if r['proname']=='transfer_order_items_to_table')
for filename,expected,replacement in [('partial_item_transfer_disable_20261024.sql',canonical,disabled),('partial_item_transfer_resume_20261024.sql',disabled,canonical)]:
 r=dict(row,definition=expected)
 (rollback_dir/filename).write_text("-- Retain additive lineage and origin-aware void/refund compatibility. No business data is rewritten.\nBEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='15s';\n"+guard(r)+replacement.rstrip().rstrip(';')+';\nCOMMIT;\n')
