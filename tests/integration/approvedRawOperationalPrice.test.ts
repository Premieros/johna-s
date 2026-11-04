import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { seedRlsFixture,runAsPersist,type RlsIds } from './rls';
import { installApprovedRawWriterFixture } from './approvedRawWriterFixture';
const url=getDbUrl();
const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('one price source with closed operational mode',()=>{
 let db:pg.Client,ids:RlsIds,purchase:string;
 const raw=randomUUID();
 beforeAll(async()=>{
  db=openDb(url);await db.connect();await db.query('BEGIN');
  await installApprovedRawWriterFixture(db,url);ids=await seedRlsFixture(db);
  await db.query("UPDATE public.roles SET permissions=permissions-'history.unlimited' WHERE role='cashier'");
  await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1::uuid,$1::text,'Operational price raw',$2,0,true)",[raw,ids.branchA]);
  // Pick a real history-restricted invoice identity without a probabilistic assertion.
  do {purchase=randomUUID();} while(parseInt(createHash('md5').update(ids.branchA+':'+purchase).digest('hex').slice(0,8),16)%100<99);
  await db.query("INSERT INTO public.purchases(id,invoice_number,supplier_id,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,created_at) VALUES($1,$2,$3,$4,$5,123,123,123,'cash','completed','2020-01-01')",[purchase,'QA-PRICE-'+purchase,ids.suppA,ids.branchA,ids.whA]);
  await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,1,123,123,0,1,'purchase','purchase',$4,'2020-01-01')",[raw,ids.branchA,ids.whA,purchase]);
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 it('uses the completed purchase for an authorized writer even when caller cannot browse that history',async()=>{
  const restricted=await runAsPersist(db,ids.users.cashier,"SELECT private.financial_row_visible($1,$2,'2020-01-01') allowed",[purchase,ids.branchA]);
  expect(restricted.error).toBeUndefined();expect(restricted.rows[0].allowed).toBe(false);
  await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)",[ids.users.cashier]);
  // Existing authorized SECURITY DEFINER writers execute their private lookup
  // as postgres while retaining the actor identity. No app helper grant exists.
  const cost=(await db.query('SELECT unit_cost,price_source FROM private.stock_count_raw_price($1,ARRAY[$2]::uuid[],NULL)',[ids.branchA,raw])).rows;
  expect(cost).toHaveLength(1);expect(Number(cost[0].unit_cost)).toBe(123);expect(cost[0].price_source).toBe('purchase');
  await db.query('RESET app.user_id');await db.query('RESET request.jwt.claim.sub');
 });
 it('cannot use operational mode from the app, including a cross-branch request',async()=>{
  for (const branch of [ids.branchA,ids.branchB]) {
   const result=await runAsPersist(db,ids.users.cashier,'SELECT * FROM private.resolve_approved_raw_prices($1,ARRAY[$2]::uuid[],NULL,true)',[branch,raw]);
   expect(result.error).toBeUndefined();expect(result.rows).toEqual([]);
  }
  const result=await runAsPersist(db,ids.users.cashier,'SELECT unit_cost FROM private.latest_approved_raw_prices($1,ARRAY[$2]::uuid[],NULL)',[ids.branchA,raw]);
  expect(result.error).toBeUndefined();expect(result.rows).toHaveLength(1);expect(result.rows[0].unit_cost).toBeNull();
 });
});
