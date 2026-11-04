import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { seedRlsFixture,type RlsIds } from './rls';
const url=getDbUrl();
const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const inner=(path:string)=>readFileSync(path,'utf8').replace(/^BEGIN;$/mg,'').replace(/^COMMIT;$/mg,'');
describe.skipIf(!local)('exact raw operational release and recovery, owned rollback only',()=>{
 let db:pg.Client,ids:RlsIds;
 const raw=randomUUID();
 const quantity=async()=>Number((await db.query('SELECT coalesce(sum(quantity),0) q FROM public.raw_material_batches WHERE raw_material_id=$1',[raw])).rows[0].q);
 beforeAll(async()=>{
  db=openDb(url);await db.connect();await db.query('BEGIN');
  const installed=(await db.query("SELECT to_regprocedure('private.finalize_raw_last_price_branch(uuid)') IS NOT NULL installed")).rows[0].installed;
  if(!installed) {
   const migration=readdirSync('supabase/migrations').find(f=>f.endsWith('_raw_last_price_operational_cutover.sql'))!;
   await db.query(inner('supabase/migrations/'+migration));
  }
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 it('installs disabled by default and restores the previous writer before activation',async()=>{
  expect((await db.query('SELECT count(*)::int n FROM private.raw_cost_v2_activated_coordinates')).rows[0].n).toBe(0);
  expect((await db.query("SELECT tgenabled FROM pg_trigger WHERE tgname='raw_last_price_new_branch_default'")).rows[0].tgenabled).toBe('D');
  await db.query(inner('scripts/rollback/raw_last_price_operational_pre_activation_20261104.sql'));
  expect((await db.query("SELECT md5(pg_get_functiondef('public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)'::regprocedure)) hash")).rows[0].hash).toBe('a042df81a4bfeb0a1be148aa9c065f76');
  await db.query(inner('scripts/recovery/raw_last_price_operational_20261104.sql'));
  expect((await db.query("SELECT position('APPROVED_RAW_V2_COORDINATE_ROUTE_V1' IN pg_get_functiondef('public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)'::regprocedure))>0 active")).rows[0].active).toBe(true);
 });
 it('recovers writers after activation without reverting quantities or original money',async()=>{
  ids=await seedRlsFixture(db);
  await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)",[ids.users.super_admin]);
  await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1::uuid,$1::text,'Recovery raw',$2,0,true)",[raw,ids.branchA]);
  expect((await db.query('SELECT private.activate_raw_last_price_coordinate($1,$2,$3,0,0,0) r',[ids.branchA,ids.whA,raw])).rows[0].r.success).toBe(true);
  const issued=(await db.query("SELECT public._raw_remove_fifo($1,$2,$3,1,'kitchen_send','qa_recovery',$4,'QA-RECOVERY',NULL,true) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
  expect(issued).toMatchObject({success:true,total_cost:0});expect(await quantity()).toBe(-1);
  const before=(await db.query('SELECT id,quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1',[raw])).rows;
  await db.query('SAVEPOINT prohibited_rollback');
  await expect(db.query(inner('scripts/rollback/raw_last_price_operational_pre_activation_20261104.sql'))).rejects.toThrow('ROLLBACK_REQUIRES_NO_ACTIVATED_COORDINATES');
  await db.query('ROLLBACK TO prohibited_rollback');await db.query('RELEASE prohibited_rollback');
  await db.query(inner('scripts/recovery/raw_last_price_operational_20261104.sql'));
  expect(await quantity()).toBe(-1);
  expect((await db.query('SELECT id,quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1',[raw])).rows).toEqual(before);
  const received=(await db.query("SELECT public._raw_add($1,$2,$3,1,7,'QA-RECOVERY',NULL,NULL,'purchase_receipt','qa_recovery',$4,'QA-RECOVERY',NULL) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
  expect(received,JSON.stringify(received)).toMatchObject({success:true,approved_price_variance_posted:7});expect(await quantity()).toBe(0);
  expect((await db.query('SELECT id FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw])).rows).toEqual([]);
 });
 it('preserves the existing trusted service adapter contract after activation',async()=>{
  await db.query('SET LOCAL ROLE service_role');
  try {
   const issued=(await db.query("SELECT public._raw_remove_fifo($1,$2,$3,0.25,'kitchen_send','qa_backend',$4,'QA-BACKEND',NULL,true) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
   expect(issued,JSON.stringify(issued)).toMatchObject({success:true,quantity:0.25});
   const received=(await db.query("SELECT public._raw_add($1,$2,$3,0.25,0,'QA-BACKEND',NULL,NULL,'adjustment','qa_backend',$4,'QA-BACKEND',NULL) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
   expect(received,JSON.stringify(received)).toMatchObject({success:true,quantity:0.25});
  } finally {await db.query('RESET ROLE');}
  expect(await quantity()).toBe(0);
  expect((await db.query("SELECT has_table_privilege('authenticated','private.raw_cost_v2_activated_coordinates','SELECT') allowed")).rows[0].allowed).toBe(false);
 });
 it('uses last price automatically for future branches after the final default switch',async()=>{
  await db.query('ALTER TABLE public.branches ENABLE TRIGGER raw_last_price_new_branch_default');
  const branch=randomUUID();
  await db.query("INSERT INTO public.branches(id,name) VALUES($1,'After global cutover')",[branch]);
  expect((await db.query('SELECT private.raw_last_price_enabled($1,$2,$3) active',[branch,randomUUID(),randomUUID()])).rows[0].active).toBe(true);
 });
});
