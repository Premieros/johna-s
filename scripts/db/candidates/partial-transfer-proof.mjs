import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.PARTIAL_TRANSFER_PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const baseline=[...JSON.parse(readFileSync('scripts/db/candidates/partial_transfer_baseline.json','utf8')),...JSON.parse(readFileSync('scripts/db/candidates/partial_transfer_extra_baseline.json','utf8'))];
if(process.env.PARTIAL_TRANSFER_SCHEMA_VARIANT==='canonical'){
 const variants=JSON.parse(readFileSync('scripts/db/candidates/partial_transfer_canonical_reversal_baseline.json','utf8'));
 for(const row of baseline){ const variant=variants.find(v=>v.proname===row.proname && v.args===row.args); if(variant) row.definition=variant.definition; }
}
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION can_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 IN ('pos.order.transfer','pos.order.create','pos.order.edit','pos.send_kitchen') AND current_setting('test.denied',true) IS DISTINCT FROM '1' $$;
CREATE FUNCTION user_may_access_branch(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1='${uid(1)}'::uuid $$;
CREATE FUNCTION is_pos_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION can_manage_other_pos_orders() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION _sent_item_void_context_matches(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION kds_order_in_user_station_scope(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION _pos_action_context_matches(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION _effective_branch_tax(uuid) RETURNS TABLE(tax_enabled boolean,tax_rate numeric) LANGUAGE sql AS $$ SELECT true,14::numeric $$;
CREATE FUNCTION next_document_number(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('success',true,'number',gen_random_uuid()) $$;
CREATE TABLE users(id uuid PRIMARY KEY,is_active boolean);
CREATE TABLE products(id uuid PRIMARY KEY,sale_price numeric,branch_id uuid,is_active boolean DEFAULT true);
CREATE FUNCTION resolve_product_modifiers(uuid,uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"success":true,"snapshot":[],"price_delta":0}'::jsonb $$;
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text,branch_id uuid,order_type text,status text,table_id uuid,customer_id uuid,cashier_id uuid,guest_count integer,notes text,subtotal numeric,discount_amount numeric,discount_type text,tax_amount numeric,total numeric,created_at timestamptz DEFAULT now(),updated_at timestamptz,kitchen_status text,kitchen_sent_at timestamptz,kitchen_ready_at timestamptz,station text,print_status text,printed_at timestamptz,payment_status text,payment_at timestamptz);
CREATE TABLE dining_tables(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid,name text,is_active boolean DEFAULT true,status text,updated_at timestamptz);
CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders,product_id uuid,unit_name text DEFAULT 'piece',quantity numeric(14,4),unit_price numeric(12,2),discount_amount numeric(14,2) DEFAULT 0,bonus_quantity numeric(14,4) DEFAULT 0,total numeric(14,2),notes text,created_at timestamptz DEFAULT now(),modifier_option_ids uuid[] DEFAULT '{}',modifiers_snapshot jsonb DEFAULT '[]');
CREATE TABLE order_kitchen_sends(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid,order_id uuid REFERENCES orders,order_item_id uuid UNIQUE REFERENCES order_items,sent_at timestamptz DEFAULT now(),sent_by uuid,sent_quantity numeric(14,4) CHECK(sent_quantity>=0));
CREATE TABLE order_kitchen_inventory_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),branch_id uuid,warehouse_id uuid,order_id uuid REFERENCES orders,order_item_id uuid,kitchen_send_id uuid REFERENCES order_kitchen_sends,sent_quantity numeric(14,6) CHECK(sent_quantity>0),voided_quantity numeric(14,6) DEFAULT 0 CHECK(voided_quantity>=0 AND voided_quantity<=sent_quantity),total_cost numeric(18,6) DEFAULT 0 CHECK(total_cost>=0),settled_sale_id uuid,created_by uuid,created_at timestamptz DEFAULT now(),component_snapshot jsonb DEFAULT '[]',snapshot_version integer DEFAULT 1);
CREATE TABLE order_kitchen_inventory_effects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid REFERENCES order_kitchen_inventory_events,branch_id uuid,warehouse_id uuid,target_type text,target_id uuid,quantity numeric(14,6) CHECK(quantity>0),total_cost numeric(18,6) CHECK(total_cost>=0),created_at timestamptz DEFAULT now(),UNIQUE(event_id,target_type,target_id));
CREATE TABLE order_inventory_consumptions(order_id uuid,order_item_id uuid,consumed_quantity numeric,reversed_quantity numeric);
CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text,entity text,entity_id uuid,details jsonb,branch_id uuid);
CREATE TABLE inventory_ledger(id uuid); CREATE TABLE print_jobs(id uuid);
-- Reject any price lookup during split; original prices must be retained.
CREATE FUNCTION _kitchen_approved_price_candidate(uuid,uuid[],timestamptz) RETURNS TABLE(raw_material_id uuid,unit_cost numeric,price_source text,priced_at timestamptz) LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'UNEXPECTED_PRICE_READ'; END $$;
CREATE FUNCTION _restore_inventory_unit_consumption_source(text,uuid,uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO test_restores(origin,quantity,event_id) VALUES($2,$6,$9); RETURN jsonb_build_object('success',true,'tracked_source',true,'restored_quantity',$6); END $$;
CREATE TABLE order_kitchen_served_quantities(order_id uuid,order_item_id uuid,served_quantity numeric,served_at timestamptz DEFAULT now(),PRIMARY KEY(order_id,order_item_id));
CREATE TABLE sale_items(id uuid,sale_id uuid,product_id uuid,quantity numeric,source_order_item_id uuid);
CREATE TABLE sale_item_inventory_effects(sale_item_id uuid,target_type text,target_id uuid,quantity numeric,warehouse_id uuid);
CREATE TABLE test_restores(origin uuid,quantity numeric,event_id uuid);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`);
for(const r of baseline)await db.exec(r.definition);
const totalsSource=readFileSync('supabase/migrations/20260902070000_p2_authoritative_order_pricing.sql','utf8');
await db.exec(totalsSource.match(/CREATE OR REPLACE FUNCTION public\._sync_order_totals_from_items\([\s\S]*?\$\$;/)[0]);
await db.exec('CREATE TRIGGER sync_totals AFTER INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION _sync_order_totals_from_items();');
await db.exec(`
REVOKE ALL ON FUNCTION transfer_order_items_to_table(uuid,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_order_items_to_table(uuid,uuid[],uuid) TO authenticated,service_role;
CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION guard_pos_operator_ownership();
CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION guard_pos_operator_ownership();
CREATE TRIGGER sent_guard BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION guard_sent_order_item_mutation();
CREATE TRIGGER ownership BEFORE INSERT OR UPDATE OR DELETE ON order_kitchen_sends FOR EACH ROW EXECUTE FUNCTION guard_kitchen_send_operator_ownership();
CREATE TRIGGER price_order BEFORE INSERT OR UPDATE OF product_id,quantity,unit_price,discount_amount,bonus_quantity,total,modifier_option_ids ON order_items FOR EACH ROW EXECUTE FUNCTION _reprice_order_item();
CREATE TRIGGER permissions BEFORE INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION enforce_pos_permission_mutation();
CREATE TRIGGER permissions BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION enforce_pos_permission_mutation();
CREATE TRIGGER permissions BEFORE INSERT OR UPDATE OR DELETE ON order_kitchen_sends FOR EACH ROW EXECUTE FUNCTION enforce_pos_permission_mutation();
CREATE TRIGGER prices BEFORE INSERT ON order_kitchen_inventory_events FOR EACH ROW EXECUTE FUNCTION _capture_kitchen_ingredient_prices();
INSERT INTO users VALUES('${uid(2)}',true);
`);
const meta=async()=>(await db.query(`SELECT proname,oid::regprocedure::text signature,prosecdef,proacl::text,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[]) ORDER BY signature`,[baseline.map(r=>r.proname)])).rows;
await db.query('INSERT INTO products(id,sale_price,branch_id) VALUES($1,20,$2)',[uid(50),uid(1)]);
if(process.env.PARTIAL_TRANSFER_SCHEMA_VARIANT==='canonical') {
 const source=readFileSync('supabase/migrations/20260923073000_snapshot_void_refund_reversal.sql','utf8');
 await db.exec(source.match(/CREATE OR REPLACE FUNCTION public\._restore_kitchen_snapshot_raws\([\s\S]*?\$function\$;/)[0]);
 await db.exec(`CREATE TABLE test_raw_restores(quantity numeric,reference_id uuid); CREATE FUNCTION _raw_add(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN INSERT INTO test_raw_restores VALUES($4,$11); RETURN '{"success":true}'::jsonb; END $$;`);
}
const before=await meta();
const migration='supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_partial_item_table_transfer.sql'));
await db.exec(readFileSync(migration,'utf8'));
for(const row of baseline.filter(r=>r.proname==='_restore_kitchen_inventory_for_void'||(r.proname==='_restore_refund_hybrid_inventory'&&r.args.startsWith('p_sale_item_id')))) {
 const body=row.definition.split('AS $function$')[1].split('$function$')[0];
 const actual=(await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[row.proname+(row.proname==='_restore_kitchen_inventory_for_void'?'(uuid,uuid,numeric)':'(uuid,uuid,uuid,numeric,uuid,uuid,text)')])).rows[0].prosrc;
 const expected=row.proname==='_restore_kitchen_inventory_for_void'
  ?body.replace(/'kitchen_send',\s+v_event.id,\s+v_effect.target_id,/,"'kitchen_send',\n          COALESCE(v_event.transfer_origin_event_id,v_event.id),\n          v_effect.target_id,")
  :body.replace('SELECT id,warehouse_id','SELECT COALESCE(transfer_origin_event_id,id) AS id,warehouse_id');
 assert.equal(actual,expected,'Reversal implementation preserved except exact lineage reference');
}
const after=await meta();assert.deepEqual(after.filter(r=>r.signature!=='transfer_order_items_to_table(uuid,uuid[],uuid,jsonb)'),before,'All modified function privilege metadata unchanged');
assert.equal(after.find(r=>r.signature.endsWith('uuid,jsonb)')).prosecdef,false);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const seed=async(n,{sent=3,voided=0,version=2,settled=false}={})=>{
 await db.exec("RESET ROLE; SET test.actor='';");
 await db.query('UPDATE products SET sale_price=20 WHERE id=$1',[uid(50)]);
 const source=uid(n),target=uid(n+1),sourceTable=uid(n+2),targetTable=uid(n+3),item=uid(n+4),send=uid(n+5),event=uid(n+6);
 await db.query(`INSERT INTO dining_tables(id,branch_id,name,status) VALUES($1,$3,'source','occupied'),($2,$3,'target','occupied')`,[sourceTable,targetTable,uid(1)]);
 await db.query(`INSERT INTO orders(id,order_number,branch_id,order_type,status,table_id,cashier_id,subtotal,discount_amount,discount_type,tax_amount,total,kitchen_status) VALUES($1,'source',$3,'dine_in','open',$4,$6,60,6,'amount',7.56,61.56,'sent'),($2,'target',$3,'dine_in','open',$5,$6,20,0,'amount',2.8,22.8,'pending')`,[source,target,uid(1),sourceTable,targetTable,uid(3)]);
 await db.query(`INSERT INTO order_items(id,order_id,product_id,quantity,unit_price,total,notes) VALUES($1,$2,$3,3,20,60,'water'),($4,$5,$3,1,20,20,'water')`,[item,source,uid(50),uid(n+7),target]);
 if(sent){
  await db.query(`INSERT INTO order_kitchen_sends(id,branch_id,order_id,order_item_id,sent_by,sent_quantity) VALUES($1,$2,$3,$4,$5,$6)`,[send,uid(1),source,item,uid(3),sent]);
  // Seed v2 frozen prices using baseline data before enabling repricing trigger.
  await db.exec('ALTER TABLE order_kitchen_inventory_events DISABLE TRIGGER prices;');
  await db.query(`INSERT INTO order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,kitchen_send_id,sent_quantity,voided_quantity,total_cost,created_by,component_snapshot,snapshot_version,settled_sale_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,9.000001,$9,$10,$11,$12)`,[event,uid(1),uid(9),source,item,send,sent+voided,voided,uid(3),JSON.stringify([{raw_material_id:uid(51),quantity:0.999999,unit_cost:9,extended_cost:9.000001,price_source:'purchase',priced_at:'2026-01-01'}]),version,settled?uid(99):null]);
  await db.query(`INSERT INTO order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost) VALUES($1,$2,$3,'inventory_unit',$4,0.999999,9.000001)`,[event,uid(1),uid(9),uid(52)]);
  await db.exec('ALTER TABLE order_kitchen_inventory_events ENABLE TRIGGER prices;');
 }
 await db.query('UPDATE products SET sale_price=20 WHERE id=$1',[uid(50)]);
 const expected=(await q(`SELECT jsonb_build_object('quantity',quantity,'product_id',product_id,'unit_name',unit_name,'unit_price',unit_price,'discount_amount',discount_amount,'bonus_quantity',bonus_quantity,'notes',COALESCE(notes,''),'modifier_option_ids',to_jsonb(modifier_option_ids)) e FROM order_items WHERE id=$1`,[item]))[0].e;
 const payload={operation_id:uid(n+8),quantities:[{order_item_id:item,quantity:1,expected}]};
 await db.exec(`SET test.actor='${uid(2)}'; SET ROLE authenticated;`);
 const run=async(p=payload)=>(await q('SELECT transfer_order_items_to_table($1,ARRAY[$2::uuid],$3,$4::jsonb) result',[source,item,targetTable,JSON.stringify(p)]))[0].result;
 return {source,target,item,event,send,sourceTable,targetTable,payload,run};
};
const a=await seed(100,{version:1});await db.exec('RESET ROLE;');await db.query('UPDATE products SET sale_price=99 WHERE id=$1',[uid(50)]);await db.exec('SET ROLE authenticated;');const result=await a.run();assert.equal(result.success,true,JSON.stringify(result));
assert.deepEqual((await q('SELECT id,quantity::float8 quantity FROM order_items WHERE order_id=$1',[a.source])),[{id:a.item,quantity:2}]);
const moved=result.quantity_transfers[0].moved_item_id;assert.notEqual(moved,a.item);
assert.equal((await q('SELECT count(*)::int n FROM order_items WHERE order_id=$1',[a.target]))[0].n,2,'Identical target line is not coalesced');
assert.equal((await q('SELECT sum(quantity)::float8 n FROM order_items WHERE order_id IN($1,$2)',[a.source,a.target]))[0].n,4);
const events=await q('SELECT * FROM order_kitchen_inventory_events WHERE order_id IN($1,$2)',[a.source,a.target]);
assert.equal((await q('SELECT unit_price::float8 price FROM order_items WHERE id=$1',[moved]))[0].price,20,'Transfer does not reprice to current product price 99');
assert.equal(events.length,2);assert.equal(events.find(e=>e.order_item_id===moved).transfer_origin_event_id,a.event);
assert.equal(Number(events.reduce((n,e)=>n+Number(e.total_cost),0).toFixed(6)),9.000001);
assert.equal(Number(events.reduce((n,e)=>n+Number(e.component_snapshot[0].quantity),0).toFixed(6)),0.999999);
assert.ok(events.every(e=>e.component_snapshot[0].price_source==='purchase' && e.component_snapshot[0].unit_cost===9));
assert.equal((await q('SELECT sum(quantity)::float8 n FROM order_kitchen_inventory_effects'))[0].n,0.999999);
assert.equal((await q('SELECT sum(total)::float8 n FROM orders WHERE id IN($1,$2)',[a.source,a.target]))[0].n,84.36,'Tax and discount allocation conserved');
assert.equal((await a.run()).replayed,true);assert.equal((await q('SELECT count(*)::int n FROM audit_log'))[0].n,1);
assert.equal((await a.run({...a.payload,quantities:[{...a.payload.quantities[0],quantity:2}]})).error,'TRANSFER_OPERATION_CONFLICT');
assert.equal((await a.run({...a.payload,operation_id:uid(190)})).error,'TRANSFER_SOURCE_CHANGED');
await db.exec('RESET ROLE;');
const voidResult=(await q('SELECT _restore_kitchen_inventory_for_void($1,$2,1) r',[a.target,moved]))[0].r;assert.equal(voidResult.success,true);
assert.deepEqual(await q('SELECT origin,quantity::float8 quantity,event_id FROM test_restores'),[{origin:a.event,quantity:0.333333,event_id:events.find(e=>e.order_item_id===moved).id}]);
const unsent=await seed(200,{sent:0});assert.equal((await unsent.run()).success,true);assert.equal((await q('SELECT count(*)::int n FROM order_kitchen_sends WHERE order_id IN($1,$2)',[unsent.source,unsent.target]))[0].n,0);
const mixed=await seed(300,{sent:2});assert.equal((await mixed.run()).success,true);assert.equal((await q('SELECT count(*)::int n FROM order_kitchen_sends WHERE order_id=$1',[mixed.target]))[0].n,0,'Unsent units move first');
const paid=await seed(400,{settled:true});assert.equal((await paid.run()).error,'TRANSFER_QUANTITY_UNAVAILABLE');
const invalid=await seed(500);assert.equal((await invalid.run({...invalid.payload,quantities:[{...invalid.payload.quantities[0],quantity:4}]})).error,'TRANSFER_QUANTITY_UNAVAILABLE');
await db.exec("SET test.denied='1';");assert.equal((await invalid.run()).error,'PERMISSION_DENIED');await db.exec('RESET test.denied;');
assert.equal((await q('SELECT transfer_order_items_to_table($1,ARRAY[$2::uuid],$3,null::jsonb) r',[invalid.source,invalid.item,invalid.targetTable]))[0].r.error,'INVALID_TRANSFER_REQUEST');
await db.exec('RESET ROLE;');
// Already-served units remain served on both exact lines and never become new KDS work.
const served=await seed(600,{version:1});await db.exec("RESET ROLE; SET test.actor='';");
await db.query('INSERT INTO order_kitchen_served_quantities(order_id,order_item_id,served_quantity) VALUES($1,$2,3)',[served.source,served.item]);
await db.query("UPDATE orders SET kitchen_status='served' WHERE id=$1",[served.source]);
await db.exec(`SET test.actor='${uid(2)}'; SET ROLE authenticated;`);const servedResult=await served.run();assert.equal(servedResult.success,true,JSON.stringify(servedResult));
await db.exec('RESET ROLE;');
assert.equal((await q('SELECT served_quantity::float8 n FROM order_kitchen_served_quantities WHERE order_id=$1',[served.source]))[0].n,2);
assert.equal((await q('SELECT served_quantity::float8 n FROM order_kitchen_served_quantities WHERE order_id=$1',[served.target]))[0].n,1);
assert.equal((await q('SELECT count(*)::int n FROM order_kitchen_sends s LEFT JOIN order_kitchen_served_quantities k ON k.order_id=s.order_id AND k.order_item_id=s.order_item_id WHERE s.order_id IN($1,$2) AND s.sent_quantity>COALESCE(k.served_quantity,0)',[served.source,served.target]))[0].n,0);
// A paid split's later legacy unit refund resolves the original consumption source.
const refundLine=servedResult.quantity_transfers[0].moved_item_id;
await db.query('UPDATE order_kitchen_inventory_events SET settled_sale_id=$1 WHERE order_item_id=$2',[uid(690),refundLine]);
await db.query('INSERT INTO sale_items VALUES($1,$2,$3,1,$4)',[uid(691),uid(690),uid(50),refundLine]);
await db.query("INSERT INTO sale_item_inventory_effects VALUES($1,'inventory_unit',$2,0.333333,$3)",[uid(691),uid(52),uid(9)]);
const refund=(await q('SELECT _restore_refund_hybrid_inventory($1,$2,$3,1,$4,$5,null::text) r',[uid(691),uid(690),uid(50),uid(1),uid(9)]))[0].r;assert.equal(refund.success,true,JSON.stringify(refund));
assert.ok((await q('SELECT * FROM test_restores WHERE origin=$1',[served.event])).length===1);
// Unsupported pre-event consumption fails atomically, without a receipt.
const atomic=await seed(700);await db.exec('RESET ROLE;');
await db.query('INSERT INTO order_inventory_consumptions VALUES($1,$2,1,0)',[atomic.source,atomic.item]);
await db.exec('SET ROLE authenticated;');const failed=await atomic.run();assert.equal(failed.success,false);
assert.equal((await q('SELECT quantity::float8 n FROM order_items WHERE id=$1',[atomic.item]))[0].n,3);
assert.equal((await q('SELECT count(*)::int n FROM audit_log WHERE id=$1',[atomic.payload.operation_id]))[0].n,0);
await db.exec('RESET ROLE;');
if(process.env.PARTIAL_TRANSFER_SCHEMA_VARIANT==='canonical') {
 const raw=await seed(800);await db.exec('RESET ROLE;');
 await db.query("UPDATE order_kitchen_inventory_effects SET target_type='raw_material',target_id=$2 WHERE event_id=$1",[raw.event,uid(51)]);
 await db.exec('SET ROLE authenticated;');const rawResult=await raw.run();assert.equal(rawResult.success,true,JSON.stringify(rawResult));await db.exec('RESET ROLE;');
 const rawLine=rawResult.quantity_transfers[0].moved_item_id;
 const rawEvent=(await q('SELECT id FROM order_kitchen_inventory_events WHERE order_item_id=$1',[rawLine]))[0].id;
 const rawVoid=(await q('SELECT _restore_kitchen_inventory_for_void($1,$2,1) r',[raw.target,rawLine]))[0].r;assert.equal(rawVoid.success,true,JSON.stringify(rawVoid));
 assert.deepEqual(await q('SELECT quantity::float8 quantity,reference_id FROM test_raw_restores'),[{quantity:0.333333,reference_id:rawEvent}],'V2 raw restore uses the real split event, not legacy consumption origin');
}
await db.exec(readFileSync('scripts/rollback/partial_item_transfer_disable_20261024.sql','utf8'));
await db.exec('SET ROLE authenticated;');assert.equal((await invalid.run()).error,'PARTIAL_TRANSFER_DISABLED');assert.equal((await a.run()).replayed,true,'Committed receipt remains replayable after rollback');
const legacy=(await q('SELECT transfer_order_items_to_table($1,ARRAY[$2::uuid],$3) r',[invalid.source,invalid.item,invalid.targetTable]))[0].r;assert.equal(legacy.success,true,'Old full-line transfer still works: '+JSON.stringify(legacy));
await db.exec('RESET ROLE;');await db.exec(readFileSync('scripts/rollback/partial_item_transfer_resume_20261024.sql','utf8'));
assert.equal((await q('SELECT count(*)::int n FROM inventory_ledger'))[0].n,0);assert.equal((await q('SELECT count(*)::int n FROM print_jobs'))[0].n,0);
await db.close();console.log((process.env.PARTIAL_TRANSFER_SCHEMA_VARIANT||'production')+': PASS: sent 3->2+1, exact IDs, snapshot/cost conservation, tax/discount, replay/conflict, stale/paid/permission rejection, no stock/print writes, unsent/mixed, legacy origin restoration, metadata, disable/replay/legacy compatibility/resume');
