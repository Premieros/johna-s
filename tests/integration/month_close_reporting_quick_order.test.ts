import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { runAs,seedRlsFixture,type RlsIds } from './rls';
import type { ConsumptionLatestResult } from '../../src/api/domains/reporting';
const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('monthly consumption and independent quick creation — owned localhost',()=>{
 let db:pg.Client;let ids:RlsIds;
 const raw=randomUUID(),missing=randomUUID(),order=randomUUID(),item=randomUUID(),event=randomUUID();
 const prefix=`MCR-${randomUUID().slice(0,8)}`;
 beforeAll(async()=>{
  db=openDb(url!);await db.connect();await db.query('BEGIN');
  await db.query("SET LOCAL statement_timeout='8s'");ids=await seedRlsFixture(db);
  await db.query(`UPDATE public.roles SET permissions=permissions || '["reports.view","reports.costing","history.unlimited"]'::jsonb WHERE role='branch_manager'`);
  await db.query(`UPDATE public.roles SET permissions='["pos.view","pos.order.quick_create"]'::jsonb WHERE role='cashier'`);
  // A positive catalog cost creates a real pricing event; start unpriced so only the explicit source fixtures compete.
  await db.query(`INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost) VALUES($1,$2,$3,$4,0),($5,$6,$7,$4,0)`,[raw,randomUUID(),prefix+' priced',ids.branchA,missing,randomUUID(),prefix+' missing']);
  await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number,created_at)
   VALUES($1,$2,$3,5,10,50,'purchase','purchase',$4,$5,now()-interval '1 hour')`,[raw,ids.branchA,ids.whA,ids.purchA,randomUUID()]);
  await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,999,'NEWER-PRICING',now()-interval '10 minutes')`,[raw,ids.branchA]);
  await db.query(`INSERT INTO public.orders(id,order_number,branch_id,cashier_id,order_type,status) VALUES($1,$2,$3,$4,'takeaway','open')`,[order,randomUUID(),ids.branchA,ids.users.cashier]);
  await db.query(`INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price,total) VALUES($1,$2,$3,2,10,20)`,[item,order,ids.prodA]);
  await db.query(`INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity) VALUES($1,$2,$3,$4,$5,2)`,[event,ids.branchA,ids.whA,order,item]);
  for(const [material,qty,type,ref,refId] of [[raw,-4,'sale','sale',ids.saleA],[raw,1,'refund','sale',ids.saleA],[raw,-2,'kitchen_send','kitchen_send',event],[raw,0.5,'kitchen_void','kitchen_send',event],[raw,-1,'waste','sale',ids.saleA],[missing,-2,'sale','sale',ids.saleA]] as const) {
   await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number) VALUES($1,$2,$3,$4::numeric,888,$4::numeric*888,$5,$6,$7,$8)`,[material,ids.branchA,ids.whA,qty,type,ref,refId,randomUUID()]);
  }
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 async function report(group='material',waste=false,page=0,size=100,user=ids.users.branch_manager,branch:string|null=ids.branchA) {
  return runAs(db,user,`SELECT public.get_consumption_latest_report($1,CURRENT_DATE-1,CURRENT_DATE+1,$2,$3,$4,$5,$6) r`,[branch,group,prefix,waste,page,size]);
 }
 it('nets refunds/voids once, uses the latest approved price and makes missing amounts numeric zero',async()=>{
  const r=await report();expect(r.error).toBeUndefined();const data=r.rows[0].r as ConsumptionLatestResult;
  const priced=data.rows.find(row=>row.raw_material_id===raw)!;
  expect(priced).toMatchObject({consumed_quantity:6,returned_quantity:1.5,net_quantity:4.5,unit_price:999,price_source:'pricing',consumption_value:4495.5,price_missing:false});
  expect(data.summary).toMatchObject({count:2,total:4495.5,unpriced_count:1,complete:false});
  expect(data.rows.find(row=>row.raw_material_id===missing)).toMatchObject({unit_price:0,price_source:'unpriced',consumption_value:0,price_missing:true});
  expect((await report('material',true)).rows[0].r).toMatchObject({summary:{total:5494.5}});
 });
 it('takes the newest price from pricing, applied count or purchase through the canonical reader',async()=>{
  await db.query('SAVEPOINT latest_price_sources');
  try {
   const count=randomUUID();
   await db.query(`INSERT INTO public.stock_counts(id,branch_id,warehouse_id,status,count_type,count_number,applied_at) VALUES($1,$2,$3,'applied','cycle',$4,clock_timestamp())`,[count,ids.branchA,ids.whA,randomUUID()]);
   await db.query(`INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,0,10,22.75)`,[count,raw]);
   let result=(await report()).rows[0].r as ConsumptionLatestResult;
   expect(result.rows.find(row=>row.raw_material_id===raw)).toMatchObject({unit_price:22.75,price_source:'stock_count'});
   await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number,created_at) VALUES($1,$2,$3,1,30,30,'purchase','purchase',$4,$5,clock_timestamp())`,[raw,ids.branchA,ids.whA,ids.purchA,randomUUID()]);
   result=(await report()).rows[0].r as ConsumptionLatestResult;
   expect(result.rows.find(row=>row.raw_material_id===raw)).toMatchObject({unit_price:30,price_source:'purchase'});
  } finally {await db.query('ROLLBACK TO SAVEPOINT latest_price_sources');await db.query('RELEASE SAVEPOINT latest_price_sources');}
 });
 it('attributes actual kitchen movements to their product without allocating unknown sale movements',async()=>{
  const r=await report('product');expect(r.error).toBeUndefined();const data=r.rows[0].r as ConsumptionLatestResult;
  expect(data.rows.find(row=>row.product_id===ids.prodA)).toMatchObject({raw_material_id:raw,net_quantity:1.5,consumption_value:1498.5});
  expect(data.rows.find(row=>row.raw_material_id===raw && !row.product_id)).toMatchObject({net_quantity:3,consumption_value:2997});
  expect(data.summary.total).toBe(4495.5);expect(data.summary.unattributed_count).toBe(2);
 });
 it('rounds only the final value so product grouping cannot change the report total',async()=>{
  await db.query('SAVEPOINT fractional_consumption');
  try {
   for(const [type,reference] of [['sale',ids.saleA],['kitchen_send',event]]) await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number) VALUES($1,$2,$3,-0.0005,10,-0.005,$4,$4,$5,$6)`,[raw,ids.branchA,ids.whA,type,reference,randomUUID()]);
   const material=(await report()).rows[0].r as ConsumptionLatestResult;
   const byProduct=(await report('product')).rows[0].r as ConsumptionLatestResult;
   expect(material.summary.total).toBe(4496.5);expect(byProduct.summary.total).toBe(material.summary.total);
  } finally {await db.query('ROLLBACK TO SAVEPOINT fractional_consumption');await db.query('RELEASE SAVEPOINT fractional_consumption');}
 });
 it('paginates details while retaining complete totals and enforces permission/branch/options',async()=>{
  const first=(await report('material',false,0,1)).rows[0].r as ConsumptionLatestResult;
  const last=(await report('material',false,1,1)).rows[0].r as ConsumptionLatestResult;
  expect(first.rows).toHaveLength(1);expect(last.rows).toHaveLength(1);expect(first.rows[0].raw_material_id).not.toBe(last.rows[0].raw_material_id);expect(first.summary).toEqual(last.summary);
  expect((await report('material',false,0,100,ids.users.cashier)).error).toContain('PERMISSION_DENIED');
  expect((await report('material',false,0,100,ids.users.branch_manager,ids.branchB)).error).toBe('BRANCH_ACCESS_DENIED');
  expect((await report('invalid')).error).toBe('INVALID_REPORT_OPTIONS');
  expect((await report('material',false,0,5001)).error).toBe('INVALID_REPORT_OPTIONS');
  expect(((await report('material',false,0,5000)).rows[0].r as ConsumptionLatestResult).summary).toEqual(first.summary);
  expect(((await report('material',false,0,100,ids.users.branch_manager,null)).rows[0].r as ConsumptionLatestResult).summary).toEqual(first.summary);
  expect((await db.query("select has_function_privilege('anon','public.get_consumption_latest_report(uuid,date,date,text,text,boolean,integer,integer)','execute') allowed")).rows[0].allowed).toBe(false);
 });
 async function create(type: string|null='takeaway',branch=ids.branchA,table: string|null=null,discount=0) {
  return runAs(db,ids.users.cashier,`select public.create_order($1,$2,$3,p_items:=$4::jsonb,p_cashier_id:=$5,p_discount_amount:=$6) r`,[branch,type,table,JSON.stringify([{product_id:ids.prodA,quantity:1,unit_price:20,total:20}]),ids.users.cashier,discount]);
 }
 it('honors restrictive ledger RLS without a duplicate report predicate and fails closed if it changes',async()=>{
  await db.query('SAVEPOINT report_rls_probe');
  try {
   await db.query(`CREATE POLICY qa_consumption_hidden_raw ON public.inventory_ledger AS RESTRICTIVE FOR SELECT TO authenticated USING (raw_material_id IS DISTINCT FROM '${missing}'::uuid)`);
   const result=await report();expect(result.error).toBeUndefined();
   expect((result.rows[0].r as ConsumptionLatestResult).summary).toMatchObject({count:1,unpriced_count:0,total:4495.5});
   await db.query('ALTER POLICY financial_visibility_inventory_ledger ON public.inventory_ledger USING (true)');
   expect((await report()).error).toContain('CONSUMPTION_RLS_BASELINE_CHANGED');
  } finally {await db.query('ROLLBACK TO SAVEPOINT report_rls_probe');await db.query('RELEASE SAVEPOINT report_rls_probe');}
 });
 it('creates a complete quick order including items and derived totals without general create/edit',async()=>{
  const result=await create();expect(result.error).toBeUndefined();expect(result.rows[0].r).toMatchObject({success:true});
  // runAs intentionally rolls back each assertion: no business rows are retained.
 });
 it('rejects other order types, null-type bypass, table binding and foreign branch',async()=>{
  for(const type of ['dine_in','delivery','drive_thru',null]) expect((await create(type)).rows[0].r).toMatchObject({success:false,error:'PERMISSION_DENIED'});
  expect((await create('takeaway',ids.branchA,randomUUID())).rows[0].r).toMatchObject({success:false,error:'PERMISSION_DENIED'});
  expect((await create('takeaway',ids.branchA,null,1)).rows[0].r).toMatchObject({success:false,error:'PERMISSION_DENIED'});
  expect((await create('takeaway',ids.branchB)).rows[0].r).toMatchObject({success:false,error:'BRANCH_MISMATCH'});
  const update=await runAs(db,ids.users.cashier,'UPDATE public.orders SET order_type=\'delivery\' WHERE id=$1',[order]);
  expect(update.error).toContain('PERMISSION_DENIED');
 });
});
