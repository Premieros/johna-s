import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { canImpersonate,runAs,seedRlsFixture,type RlsIds } from './rls';
type Page={rows:{order_id:string;order_number:string;kitchen_status:string;updated_at:string}[];count:number};
const dbUrl=getDbUrl();
describe.skipIf(!dbUrl)('completed KDS history under caller RLS',()=>{
 let client:pg.Client;let ids:RlsIds;const prefix='KDS-H-'+randomUUID().slice(0,8);
 beforeAll(async()=>{
  client=openDb(dbUrl!);await client.connect();await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='8s'");
  if(!await canImpersonate(client))throw new Error('Isolated CI auth stub required');
  ids=await seedRlsFixture(client);
  await client.query(`UPDATE public.roles SET permissions=permissions || '["pos.kds_view"]'::jsonb WHERE role IN ('cashier','production_manager')`);
  await client.query(`UPDATE public.roles SET permissions=permissions - 'pos.kds_view' WHERE role='warehouse_manager'`);
  await client.query(`INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type,status,kitchen_status,station,updated_at)
    SELECT $1||'-'||n,$2,$3,'takeaway','open','served','main',now() FROM generate_series(1,205) n`,[prefix,ids.branchA,ids.users.cashier]);
  await client.query(`INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type,status,kitchen_status,station,updated_at)
    VALUES ($1||'-other',$2,$3,'takeaway','open','served','main',now()),
           ($1||'-station',$4,$5,'takeaway','open','served','salad',now()),
           ($1||'-active',$4,$5,'takeaway','open','sent','main',now()),
           ($1||'-past',$4,$5,'takeaway','open','served','main',now()-interval '2 days')`,[prefix,ids.branchB,ids.users.cashier_b,ids.branchA,ids.users.cashier]);
  await client.query(`INSERT INTO public.user_kitchen_station_assignments(user_id,branch_id,station_id,created_by)
    SELECT $1,$2,ks.id,$1 FROM public.kitchen_stations ks WHERE ks.branch_id=$2 AND ks.code='main'`,[ids.users.production_manager,ids.branchA]);
 });
 afterAll(async()=>{if(client){await client.query('ROLLBACK').catch(()=>{});await client.end();}});
 async function page(user=ids.users.cashier,branch=ids.branchA,station:string|null=null,page=0){
  return runAs(client,user,`SELECT public.get_kitchen_completed_history($1,now()-interval '1 hour',now()+interval '1 hour',$2,$3) AS page`,[branch,station,page]);
 }
 it('returns 100-row pages and full counts with deterministic ties and no writes',async()=>{
  const before=await client.query(`SELECT id,kitchen_status,updated_at FROM public.orders WHERE branch_id=$1 ORDER BY id`,[ids.branchA]);
  const all:string[]=[];for(const n of [0,1,2]){const result=await page(ids.users.production_manager,ids.branchA,null,n);expect(result.error).toBeUndefined();const p=result.rows[0].page as Page;expect(p.count).toBe(205);expect(p.rows).toHaveLength(n===2?5:100);all.push(...p.rows.map(r=>r.order_id));}
  expect(new Set(all).size).toBe(205);
  const direct=await runAs(client,ids.users.production_manager,`SELECT id FROM public.orders WHERE branch_id=$1 AND kitchen_status='served' AND station='main' AND updated_at>=now()-interval '1 hour' ORDER BY updated_at DESC,id DESC`,[ids.branchA]);
  expect(all).toEqual(direct.rows.map(r=>r.id));
  const after=await client.query(`SELECT id,kitchen_status,updated_at FROM public.orders WHERE branch_id=$1 ORDER BY id`,[ids.branchA]);expect(after.rows).toEqual(before.rows);
 });
 it('keeps allowed stations isolated and accepts view-only users',async()=>{
  const main=await page(ids.users.production_manager,ids.branchA,'main');expect(main.error).toBeUndefined();expect((main.rows[0].page as Page).count).toBe(205);
  const denied=await page(ids.users.production_manager,ids.branchA,'salad');expect(denied.error).toBeUndefined();expect(denied.rows[0].page).toEqual({rows:[],count:0});
  const viewer=await page();expect(viewer.error).toBeUndefined();expect((viewer.rows[0].page as Page).count).toBe(206);
 });
 it('rejects foreign branches, missing KDS permission and invalid pages',async()=>{
  expect((await page(ids.users.cashier_b)).error).toContain('BRANCH_ACCESS_DENIED');
  expect((await page(ids.users.warehouse_manager)).error).toContain('POS_KDS_VIEW_REQUIRED');
  expect((await page(ids.users.cashier,ids.branchA,null,-1)).error).toContain('REPORT_PAGE_INVALID');
 });
 it('preserves existing financially hidden completed history',async()=>{
  await client.query(`INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type,status,kitchen_status,station,created_at,updated_at)
    VALUES($1||'-paid',$2,$3,'takeaway','completed','served','main',now()-interval '30 days',now())`,[prefix,ids.branchA,ids.users.cashier]);
  const p=await page();expect(p.error).toBeUndefined();
  const direct=await runAs(client,ids.users.cashier,`SELECT count(*)::integer AS count FROM public.orders WHERE branch_id=$1 AND kitchen_status IN ('served','cancelled') AND updated_at>=now()-interval '1 hour' AND updated_at<now()+interval '1 hour'`,[ids.branchA]);
  expect((p.rows[0].page as Page).count).toBe(direct.rows[0].count);
 });
 it('is stable invoker with anonymous execute revoked and no operational mutations',async()=>{
  const r=await client.query(`SELECT p.prosecdef,p.provolatile,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_kitchen_completed_history'`);
  expect(r.rows).toHaveLength(1);expect(r.rows[0]).toMatchObject({prosecdef:false,provolatile:'s',anon:false,auth:true});expect(r.rows[0].definition).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
 });
});
