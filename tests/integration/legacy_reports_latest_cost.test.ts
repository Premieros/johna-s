import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
const url = getDbUrl();
const local = !!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const smouha = '19c3fd23-d784-455b-8840-f4f2ac619651';
describe.skipIf(!local)('installed agent report pages and latest raw cost — owned localhost only', () => {
 let db: pg.Client; let ids: RlsIds; const raw=randomUUID(), missing=randomUUID();
 const call = async (actor: string, query: string, args: unknown[]=[]) => {
  const r=await runAsPersist(db,actor,query,args); expect(r.error).toBeUndefined(); return r.rows[0]?.r as Record<string, unknown>;
 };
 beforeAll(async()=>{
  db=openDb(url!);await db.connect();await db.query('BEGIN');
  // Rehearse the historical split contract only inside this owned-localhost rollback transaction.
  await db.query(readFileSync('supabase/migrations/20261016224825_report_normalizer_production_dependency.sql','utf8'));
  ids=await seedRlsFixture(db);
  await db.query(`UPDATE public.roles SET permissions=permissions || '["reports.costing","shifts.report.shift"]'::jsonb WHERE role='branch_manager'`);
  await db.query(`UPDATE public.roles SET permissions=permissions - 'reports.costing' - 'shifts.report.shift' - 'shifts.day_close' WHERE role='cashier'`);
  await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost) VALUES($1,$2,'Priced raw',$3,0),($4,$5,'Unpriced raw',$3,0)",[raw,randomUUID(),ids.branchA,missing,randomUUID()]);
  await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,17,'LATEST-CONSUMPTION',clock_timestamp())",[raw,ids.branchA]);
  for(const material of [raw,missing]) await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number) VALUES($1,$2,$3,-2,999,-1998,'sale','sale',$4,$5)",[material,ids.branchA,ids.whA,ids.saleA,randomUUID()]);
  await db.query("INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,-3,999) ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=-3,avg_cost=999",[raw,ids.branchA]);
  // Fixed real branch is isolated to this localhost transaction, no production call.
  await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Smouha report fixture')",[smouha]);
 },60000);
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 it('detects and repairs the production-only missing normalizer before restoring bounded enqueues',async()=>{
  await db.query('SAVEPOINT missing_report_helper');
  try {
   await db.query('DROP FUNCTION public._normalize_thermal_print_payload(jsonb)');
   const metadata=await db.query("select public._production_api_contract_v1($1::jsonb) r",[JSON.stringify({rpcs:[{name:'_normalize_thermal_print_payload',params:['payload']}],tables:['cloud_print_jobs']})]);
   expect(metadata.rows[0].r.rpcs[0].present).toBe(false);
   const failed=await runAs(db,ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3)',[smouha,{text:'Never committed'},randomUUID()]);
   expect(failed.error).toMatch(/_normalize_thermal_print_payload.*does not exist/);
   const file=readdirSync('supabase/migrations').find(name=>name.endsWith('_report_normalizer_production_dependency.sql'))!;
   await db.query(readFileSync('supabase/migrations/'+file,'utf8'));
   const repaired=await call(ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3) r',[smouha,{text:'Repaired report\n'.repeat(60)},randomUUID()]);
   expect(repaired.success).toBe(true);expect(Number(repaired.pages)).toBeGreaterThan(1);
  } finally { await db.query('ROLLBACK TO SAVEPOINT missing_report_helper');await db.query('RELEASE SAVEPOINT missing_report_helper'); }
 });
 it('keeps every character of a long Arabic report, caps each part and orders/idempotently creates the whole batch',async()=>{
  const text=Array.from({length:341},(_,i)=>`خامة ${i} | الكمية 1.2345 | 17 EGP`).join('\r\n');const key='qa-report:'+randomUUID();
  const result=await call(ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3) r',[smouha,{text,paperWidthMm:80,copies:1},key]);
  expect(result.success).toBe(true);expect(Number(result.pages)).toBeGreaterThan(1);
  const jobs=(await db.query("select id,payload,kind,station_code,created_at from public.cloud_print_jobs where id=ANY($1::uuid[]) order by created_at,id",[result.job_ids])).rows;
  expect(jobs).toHaveLength(Number(result.pages));
  expect(jobs.map(j=>j.payload.text.replace(/^Z \[\d+\/\d+\]\n/,'')).join('')).toBe(text.replace(/\r\n/g,'\n'));
  jobs.forEach((j,i)=>{expect(j.payload.report_page).toBe(i+1);expect(j.payload.text.length).toBeLessThanOrEqual(340);expect(j.payload.text.split('\n').length).toBeLessThanOrEqual(14);expect(j).toMatchObject({kind:'report',station_code:'cashier'});});
  const again=await call(ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3) r',[smouha,{text:'changed'},key]);
  expect(again.job_id).toBe(result.job_id);expect(again.deduplicated).toBe(true);
  expect((await db.query('select count(*)::int n from public.cloud_print_jobs where id=ANY($1::uuid[])',[result.job_ids])).rows[0].n).toBe(jobs.length);
 });
 it('preserves old root jobs, short reports and other branches; rolls back every page on a child-key collision',async()=>{
  const oldKey='old:'+randomUUID();const old=(await db.query("insert into public.cloud_print_jobs(branch_id,requested_by,kind,station_code,payload,idempotency_key) values($1,$2,'report','cashier',$3,$4) returning id",[smouha,ids.users.super_admin,{text:'old accepted'},oldKey])).rows[0].id;
  expect((await call(ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3) r',[smouha,{text:'LONG '.repeat(2000)},oldKey])).job_id).toBe(old);
  for(const [branch,text] of [[smouha,'Short Z report'],[ids.branchA,'Other branch '.repeat(200)]]) {
   const r=await call(ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3) r',[branch,{text},randomUUID()]);expect(r.pages).toBe(1);
  }
  const collision='collision:'+randomUUID();await db.query("insert into public.cloud_print_jobs(branch_id,requested_by,kind,station_code,payload,idempotency_key) values($1,$2,'report','cashier',$3,$4)",[smouha,ids.users.super_admin,{text:'Existing independent job'},collision+':page:2']);
  const failed=await runAs(db,ids.users.super_admin,'select public.enqueue_cloud_report_print($1,$2,$3)',[smouha,{text:'Long report\n'.repeat(100)},collision]);expect(failed.error).toMatch(/duplicate key/);
  expect((await db.query('select id from public.cloud_print_jobs where branch_id=$1 and idempotency_key=$2',[smouha,collision])).rows).toHaveLength(0);
 });
 it('values consumption and compact balance at last approved price without reading historical FIFO cost',async()=>{
  const before=(await db.query('select count(*)::int n,sum(quantity)::text qty from public.inventory_ledger')).rows;
  const result=await runAs(db,ids.users.branch_manager,"select * from public.get_raw_consumption_latest_cost($1,now()-interval '1 day',now()+interval '1 day') where raw_material_id=ANY($2::uuid[])",[ids.branchA,[raw,missing]]);
  expect(result.error).toBeUndefined();expect(result.rows).toHaveLength(2);
  expect(result.rows.find(r=>r.raw_material_id===raw)).toMatchObject({consumed_quantity:'2.000000',displayed_cost:'34.00',price_missing:false,pricing_basis:'latest_approved'});
  expect(result.rows.find(r=>r.raw_material_id===missing)).toMatchObject({price_missing:true});
  const values=await runAs(db,ids.users.branch_manager,'select * from public.get_raw_material_latest_valuation($1) where raw_material_id=$2',[ids.branchA,raw]);expect(values.error).toBeUndefined();
  expect(Number(values.rows[0]?.stock_quantity)).toBe(-3);
  expect(values.rows[0]).toMatchObject({latest_cost:'17.000000',estimated_net_stock_value:'-51.00',price_missing:false});
  expect((await db.query('select count(*)::int n,sum(quantity)::text qty from public.inventory_ledger')).rows).toEqual(before);
 });
 it('denies unauthorized/foreign branch reads and anonymous function access',async()=>{
  const q="select * from public.get_raw_consumption_latest_cost($1,now()-interval '1 day',now())";
  expect((await runAs(db,ids.users.cashier,q,[ids.branchA])).error).toBe('NOT_ALLOWED');
  expect((await runAs(db,ids.users.branch_manager,q,[ids.branchB])).error).toBe('BRANCH_MISMATCH');
  for(const signature of ['public.get_raw_consumption_latest_cost(uuid,timestamptz,timestamptz)','public.get_raw_material_latest_valuation(uuid)'])expect((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[signature])).rows[0].allowed).toBe(false);
 });
});
