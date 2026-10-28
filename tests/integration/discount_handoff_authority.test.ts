import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type pg from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {getDbUrl,openDb} from './db';
import {runAs,runAsPersist,seedRlsFixture,type RlsIds} from './rls';
const dbUrl=getDbUrl();
describe.skipIf(!dbUrl)('permission-based saved discount handoff',()=>{
 let client:pg.Client; let ids:RlsIds;
 beforeEach(async()=>{
  client=openDb(dbUrl!);await client.connect();await client.query('BEGIN');ids=await seedRlsFixture(client);
  await client.query(`UPDATE public.roles SET permissions=(permissions || '["pos.order.edit","pos.payment.take"]'::jsonb)-'pos.discount' WHERE role='cashier'`);
  await client.query(`UPDATE public.roles SET permissions=permissions || '["pos.order.edit","pos.payment.take","pos.discount"]'::jsonb WHERE role IN ('branch_manager','warehouse_manager')`);
  await client.query('UPDATE public.orders SET subtotal=20,total=20,inventory_warehouse_id=$2 WHERE id=$1',[ids.rows.orders.own,ids.whA]);
  await client.query(`INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity,sent_by) SELECT $2,order_id,id,1,$3 FROM public.order_items WHERE order_id=$1`,[ids.rows.orders.own,ids.branchA,ids.users.cashier]);
  await client.query(`INSERT INTO public.order_kitchen_inventory_events(order_id,order_item_id,branch_id,warehouse_id,sent_quantity) SELECT order_id,id,$2,$3,1 FROM public.order_items WHERE order_id=$1`,[ids.rows.orders.own,ids.branchA,ids.whA]);
 });
 afterEach(async()=>{if(client){await client.query('ROLLBACK');await client.end();}});
 const apply=async(user:string,amount=5)=>{
  const r=await runAsPersist(client,user,'SELECT public.set_order_checkout_discount($1,$2,NULL) r',[ids.rows.orders.own,amount]);
  expect(r.error).toBeUndefined();return r.rows[0].r as {success:boolean;error?:string};
 };
 const pay=async(split=false,amount=5)=>{
  const preview=(await client.query('SELECT public._build_order_settlement_preview($1) r',[ids.rows.orders.own])).rows[0].r;
  const paid=20-amount;
  const collection=split ? `p_payments := $5::jsonb` : `p_paid_amount := $5::numeric, p_payment_method := 'cash'`;
  const method=split?'process_sale_split':'process_sale';
  const r=await runAsPersist(client,ids.users.cashier,`SELECT public.${method}(
   p_invoice_number := $1,p_branch_id := $2,p_warehouse_id := $3,p_customer_id := NULL,p_salesperson_id := NULL,
   p_subtotal := 20,p_discount_amount := $4,p_discount_type := 'amount',p_tax_amount := 0,p_bonus_amount := 0,p_total := $6,
   ${collection},p_status := 'completed',p_items := $7::jsonb,p_shift_id := $8,p_order_type := 'dine_in',p_table_id := NULL,p_order_id := $9,p_guest_count := NULL) r`,
   [`HANDOFF-${split}-${ids.rows.orders.own}`,ids.branchA,ids.whA,amount,split?JSON.stringify([{payment_method:'cash',amount:5},{payment_method:'card',amount:paid-5}]):paid,paid,JSON.stringify(preview.items),ids.shiftA,ids.rows.orders.own]);
  expect(r.error).toBeUndefined();return r.rows[0].r as {success:boolean;error?:string;sale_id?:string;order_completed?:boolean};
 };
 for(const split of [false,true]) it(`cashier settles a saved authorized discount with ${split?'split':'normal'} payment`,async()=>{
  expect(await apply(ids.users.branch_manager)).toMatchObject({success:true});
  const proof=(await client.query('SELECT authorized_by FROM private.pos_order_discount_authority WHERE order_id=$1',[ids.rows.orders.own])).rows[0];
  expect(proof.authorized_by).toBe(ids.users.branch_manager);
  const r=await pay(split);expect(r.success,JSON.stringify(r)).toBe(true);expect(r.order_completed).toBe(true);
  const s=(await client.query('SELECT discount_amount,total FROM public.sales WHERE id=$1',[r.sale_id])).rows[0];
  expect(Number(s.discount_amount)).toBe(5);expect(Number(s.total)).toBe(15);
  const audit=(await client.query("SELECT details->>'authorized_by' actor FROM public.audit_log WHERE entity_id=$1 AND action='ORDER_DISCOUNT_INHERITED'",[ids.rows.orders.own])).rows[0];
  expect(audit.actor).toBe(ids.users.branch_manager);
 });
 it('uses discount capability rather than a manager role name',async()=>{
  expect(await apply(ids.users.warehouse_manager)).toMatchObject({success:true});
  expect((await pay()).success).toBe(true);
 });
 it('discount authorization does not grant or require collection authority for its author',async()=>{
  await client.query(`UPDATE public.roles SET permissions=permissions-'pos.payment.take' WHERE role='branch_manager'`);
  await client.query('UPDATE public.orders SET cashier_id=$2 WHERE id=$1',[ids.rows.orders.own,ids.users.branch_manager]);
  const written=await runAsPersist(client,ids.users.branch_manager,"UPDATE public.orders SET discount_amount=5,discount_type='amount',total=15 WHERE id=$1 RETURNING id",[ids.rows.orders.own]);
  expect(written.error).toBeUndefined();expect(written.rowCount).toBe(1);
  expect((await pay()).success).toBe(true);
 });
 it('a manager label without discount capability cannot create handoff proof',async()=>{
  await client.query(`UPDATE public.roles SET permissions=permissions-'pos.discount' WHERE role='branch_manager'`);
  expect(await apply(ids.users.branch_manager)).toMatchObject({success:false,error:'MANAGER_APPROVAL_REQUIRED'});
  expect((await client.query('SELECT count(*)::int n FROM private.pos_order_discount_authority WHERE order_id=$1',[ids.rows.orders.own])).rows[0].n).toBe(0);
 });
 it('does not trust a legacy or subsequently altered discount budget without fresh authorization',async()=>{
  await client.query('UPDATE public.orders SET discount_amount=5,discount_type=\'amount\' WHERE id=$1',[ids.rows.orders.own]);
  expect((await pay()).success).toBe(false);
  expect(await apply(ids.users.branch_manager)).toMatchObject({success:true});
  await client.query('UPDATE public.orders SET discount_amount=6 WHERE id=$1',[ids.rows.orders.own]);
  expect((await pay(false,6)).success).toBe(false);
 });
 it('does not consume or lose handoff authorization when settlement fails',async()=>{
  expect((await apply(ids.users.branch_manager)).success).toBe(true);
  await client.query("UPDATE public.shifts SET status='closed' WHERE id=$1",[ids.shiftA]);
  expect((await pay()).success).toBe(false);
  expect((await client.query('SELECT count(*)::int n FROM private.pos_order_discount_authority WHERE order_id=$1',[ids.rows.orders.own])).rows[0].n).toBe(1);
  expect((await client.query("SELECT count(*)::int n FROM public.audit_log WHERE entity_id=$1 AND action='ORDER_DISCOUNT_INHERITED'",[ids.rows.orders.own])).rows[0].n).toBe(0);
 });
 it('rejects direct table proof forgery and invoice inserts even with a forged transaction marker',async()=>{
  expect((await apply(ids.users.branch_manager)).success).toBe(true);
  const proof=await runAs(client,ids.users.cashier,'SELECT * FROM private.pos_order_discount_authority');expect(proof.error).toBeTruthy();
  const token=(await client.query('SELECT to_jsonb(a) proof FROM private.pos_order_discount_authority a WHERE order_id=$1',[ids.rows.orders.own])).rows[0].proof;
  await runAsPersist(client,ids.users.cashier,"SELECT set_config('app.pos_discount_handoff',$1,true)",[JSON.stringify({order_id:ids.rows.orders.own,branch_id:ids.branchA,invoice_number:'FORGED-HANDOFF',discount_amount:5,subtotal:20,authority:token})]);
  const insert=await runAs(client,ids.users.cashier,"INSERT INTO public.sales(invoice_number,branch_id,subtotal,discount_amount,total,paid_amount,payment_method,status) VALUES('FORGED-HANDOFF',$1,20,5,15,15,'cash','completed')",[ids.branchA]);
  expect(insert.error).toContain('DISCOUNT_NOT_ALLOWED');
 });
 it('rollback and reapply preserve existing function metadata and exact bodies',async()=>{
  const read=()=>client.query("SELECT p.proname,p.pronargs,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proowner,p.proacl,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('process_sale','process_sale_split','enforce_pos_permission_mutation','guard_sale_discount') ORDER BY p.proname,p.pronargs");
  const before=(await read()).rows;expect(before).toHaveLength(4);await client.query('SAVEPOINT handoff_rollback');
  try {
   await client.query(readFileSync('scripts/rollback/discount_handoff_authority_20261028.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
   const migration=readdirSync('supabase/migrations').find(f=>f.endsWith('_discount_handoff_authority.sql'))!;
   await client.query(readFileSync(`supabase/migrations/${migration}`,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
   expect((await read()).rows).toEqual(before);
  } finally {await client.query('ROLLBACK TO SAVEPOINT handoff_rollback');}
 });
});
