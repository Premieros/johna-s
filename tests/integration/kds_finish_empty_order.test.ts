import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { canImpersonate,runAs,seedRlsFixture,type RlsIds } from './rls';
const dbUrl=getDbUrl();
describe.skipIf(!dbUrl)('explicit administrative empty voided kitchen finish',()=>{
 let client:pg.Client;let ids:RlsIds;let empty:string;let hasItems:string;let nonFinal:string;let notVoid:string;
 beforeAll(async()=>{
  client=openDb(dbUrl!);await client.connect();await client.query('BEGIN');
  if(!await canImpersonate(client))throw new Error('Isolated CI auth stub required');ids=await seedRlsFixture(client);
  const prefix='EMPTY-KDS-'+randomUUID().slice(0,8);
  const orders=await client.query(`INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type,status,kitchen_status,station,notes,total)
    VALUES($1||'-empty',$2,$3,'takeaway','completed','cooking','main','- Kitchen void: 1x Test',40),
          ($1||'-items',$2,$3,'takeaway','completed','cooking','main','- Kitchen void: 1x Test',40),
          ($1||'-open',$2,$3,'takeaway','open','cooking','main','- Kitchen void: 1x Test',40),
          ($1||'-no-void',$2,$3,'takeaway','completed','cooking','main',NULL,40) RETURNING id,order_number`,[prefix,ids.branchA,ids.users.cashier]);
  empty=orders.rows.find(r=>r.order_number.endsWith('-empty')).id;hasItems=orders.rows.find(r=>r.order_number.endsWith('-items')).id;
  nonFinal=orders.rows.find(r=>r.order_number.endsWith('-open')).id;notVoid=orders.rows.find(r=>r.order_number.endsWith('-no-void')).id;
  await client.query(`INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,total) VALUES($1,$2,1,40,40)`,[hasItems,ids.prodA]);
  await client.query(`INSERT INTO public.user_kitchen_station_assignments(user_id,branch_id,station_id,created_by)
    SELECT $1,$2,id,$1 FROM public.kitchen_stations WHERE branch_id=$2 AND code='grill'`,[ids.users.super_admin,ids.branchA]);
 });
 afterAll(async()=>{if(client){await client.query('ROLLBACK').catch(()=>{});await client.end();}});
 async function finish(order=empty,user=ids.users.super_admin,branch=ids.branchA){return runAs(client,user,'SELECT public.finish_empty_kitchen_order($1,$2) AS result',[order,branch]);}
 it('finishes only kitchen state and audit while retaining financial, stock, served and print records',async()=>{
  const before=await client.query(`SELECT to_jsonb(o)-ARRAY['kitchen_status','updated_at'] AS data FROM public.orders o WHERE id=$1`,[empty]);
  const snapshot=async()=> (await client.query(`SELECT (SELECT count(*) FROM public.cloud_print_jobs) AS prints,(SELECT count(*) FROM public.order_kitchen_inventory_events) AS kitchen_inventory,(SELECT count(*) FROM public.raw_material_movements) AS raw_consumption,(SELECT count(*) FROM public.order_kitchen_served_quantities) AS served_baselines,(SELECT count(*) FROM public.sales) AS sales,(SELECT count(*) FROM public.journal_entries) AS journals,(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'[]')) FROM public.raw_material_inventory r) AS stock_digest`)).rows[0];
  const counts=await snapshot();const result=await finish();expect(result.error).toBeUndefined();expect(result.rows[0].result).toEqual({success:true,changed:true});
  const after=await client.query(`SELECT kitchen_status,to_jsonb(o)-ARRAY['kitchen_status','updated_at'] AS data FROM public.orders o WHERE id=$1`,[empty]);
  expect(after.rows[0].kitchen_status).toBe('cancelled');expect(after.rows[0].data).toEqual(before.rows[0].data);expect(await snapshot()).toEqual(counts);
  const audit=await client.query(`SELECT user_id,details FROM public.audit_log WHERE entity_id=$1 AND action='kitchen_empty_finish'`,[empty]);expect(audit.rows).toHaveLength(1);expect(audit.rows[0].user_id).toBe(ids.users.super_admin);
  const queue=await runAs(client,ids.users.super_admin,`SELECT order_id FROM public.get_kitchen_queue(NULL,$1) WHERE order_id=$2`,[ids.branchA,empty]);expect(queue.error).toBeUndefined();expect(queue.rows).toHaveLength(0);
  const history=await runAs(client,ids.users.super_admin,`SELECT public.get_kitchen_completed_history($1,now()-interval '1 hour',now()+interval '1 hour',NULL,0) AS result`,[ids.branchA]);expect(history.error).toBeUndefined();expect((history.rows[0].result as {rows:{order_id:string}[]}).rows.some(r=>r.order_id===empty)).toBe(true);
 });
 it('is idempotent and cannot add duplicate audit records',async()=>{const result=await finish();expect(result.error).toBeUndefined();expect(result.rows[0].result).toEqual({success:true,changed:false});const audit=await client.query(`SELECT count(*)::integer AS count FROM public.audit_log WHERE entity_id=$1 AND action='kitchen_empty_finish'`,[empty]);expect(audit.rows[0].count).toBe(1);});
 it('blocks remaining items, non-final orders and closed orders with no void evidence',async()=>{
  expect((await finish(hasItems)).error).toContain('EMPTY_KDS_ORDER_HAS_ITEMS');
  expect((await finish(nonFinal)).error).toContain('EMPTY_KDS_ORDER_NOT_FINAL');
  expect((await finish(notVoid)).error).toContain('EMPTY_KDS_ORDER_NOT_FINAL');
 });
 it('keeps ordinary KDS users and foreign branches outside the cleanup capability',async()=>{
  expect((await finish(empty,ids.users.cashier)).error).toContain('EMPTY_KDS_ADMIN_REQUIRED');
  expect((await finish(empty,ids.users.branch_manager,ids.branchB)).error).toContain('BRANCH_ACCESS_DENIED');
 });
 it('uses invoker RLS and introduces no replacement station/dispatch/printing helper',async()=>{
  const row=await client.query(`SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='finish_empty_kitchen_order'`);expect(row.rows).toHaveLength(1);expect(row.rows[0]).toMatchObject({prosecdef:false,anon:false,auth:true});expect(row.rows[0].definition).toContain('FOR UPDATE');expect(row.rows[0].definition).not.toMatch(/(?:send_to_kitchen|_record_kitchen_served_baseline|INSERT INTO public.cloud_print_jobs|UPDATE public.sales)/);
 });
});
