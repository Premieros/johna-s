import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type pg from 'pg';
import {getDbUrl,openDb} from './db';
import {runAs,runAsPersist,seedRlsFixture,type RlsIds} from './rls';
const url=getDbUrl();const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('receiving action capability — owned rollback fixtures',()=>{
 let db:pg.Client;let ids:RlsIds;
 beforeAll(async()=>{db=openDb(url!);await db.connect();await db.query('BEGIN');ids=await seedRlsFixture(db);});
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 async function createPurchase(){
  const r=await runAsPersist(db,ids.users.super_admin,`SELECT public.create_purchase_order($1,$2,$3,'credit','permission QA',$4::jsonb,NULL) result`,[ids.branchA,ids.suppA,ids.whA,JSON.stringify([{product_id:ids.prodA,quantity:2,unit_cost:10,unit_name:'piece'}])]);
  expect(r.error).toBeUndefined();const created=r.rows[0].result as {success:boolean;purchase_id:string};expect(created.success).toBe(true);
  for(const status of ['submitted','approved'])expect((await runAsPersist(db,ids.users.super_admin,'SELECT public.update_purchase_order_status($1,$2) result',[created.purchase_id,status])).rows[0].result).toMatchObject({success:true});
  const item=(await db.query('SELECT id FROM public.purchase_items WHERE purchase_id=$1',[created.purchase_id])).rows[0].id;return{purchase:created.purchase_id,item};
 }
 async function grant(permissions:string[],active=true){await db.query('UPDATE public.roles SET permissions=$1::jsonb,is_active=$2 WHERE role=\'cashier\'',[JSON.stringify(permissions),active]);}
 const receive=(purchase:string,item:string)=>runAs(db,ids.users.cashier,'SELECT public.receive_purchase_order($1,$2::jsonb) result',[purchase,JSON.stringify([{purchase_item_id:item,quantity_received:1}])]);
 for(const capability of ['procurement.receive','purchases.manage'])it(`${capability} performs a real partial receipt without other permissions`,async()=>{
  const p=await createPurchase();await grant([capability]);const visible=await runAs(db,ids.users.cashier,'SELECT purchase_id FROM public.get_purchase_backorders($1) WHERE purchase_id=$2',[ids.branchA,p.purchase]);expect(visible.error).toBeUndefined();expect(visible.rows.length).toBeGreaterThan(0);const r=await receive(p.purchase,p.item);expect(r.error).toBeUndefined();expect(r.rows[0].result).toMatchObject({success:true,fully_received:false});
  const check=await runAs(db,ids.users.cashier,"SELECT public.can_permission('purchases.manage') manage,public.can_permission('procurement.payment.create') pay,public.can_permission('accounting.journal.post') journal");expect(check.rows[0]).toEqual({manage:capability==='purchases.manage',pay:false,journal:false});
 });
 it('view-only and inactive receiver cannot change receipt, stock or journals',async()=>{
  const p=await createPurchase();const before=(await db.query('SELECT received_quantity FROM public.purchase_items WHERE id=$1',[p.item])).rows;
  for(const [perms,active] of [[['purchases.receiving','purchases.view'],true],[['procurement.receive'],false]] as const){await grant([...perms],active);expect((await receive(p.purchase,p.item)).rows[0].result).toMatchObject({success:false,error:'NOT_ALLOWED'});}
  expect((await db.query('SELECT received_quantity FROM public.purchase_items WHERE id=$1',[p.item])).rows).toEqual(before);expect((await db.query('SELECT id FROM public.purchase_receipts WHERE purchase_id=$1',[p.purchase])).rows).toHaveLength(0);
 });
 it('receiver cannot receive a foreign branch purchase',async()=>{
  await grant(['procurement.receive']);const item=(await db.query('SELECT id FROM public.purchase_items WHERE purchase_id=$1',[ids.purchB])).rows[0].id;
  expect((await receive(ids.purchB,item)).rows[0].result).toMatchObject({success:false,error:'BRANCH_MISMATCH'});
 });
 it('shared print transport contract stays intact for a receipt-only agent',async()=>{
  await grant(['pos.receipt.print']);const r=await runAs(db,ids.users.cashier,"SELECT public.can_execute_cloud_print_kind('kitchen') kitchen,public.can_execute_cloud_print_kind('receipt') receipt,public.can_execute_cloud_print_kind('report') report");expect(r.rows[0]).toEqual({kitchen:true,receipt:true,report:true});
 });
});
