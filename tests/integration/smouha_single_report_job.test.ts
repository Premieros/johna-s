import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { runAsPersist,seedRlsFixture,type RlsIds } from './rls';
const url=getDbUrl();
const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const smouha='19c3fd23-d784-455b-8840-f4f2ac619651',cleopatra='279e6662-e901-40b2-9170-7dda0b471ba7';
describe.skipIf(!local)('single report enqueue, same path for Smouha and Cleopatra — localhost only',()=>{
 let db:pg.Client;let ids:RlsIds;
 beforeAll(async()=>{db=openDb(url!);await db.connect();await db.query('BEGIN');ids=await seedRlsFixture(db);await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Smouha single report QA'),($2,'Cleopatra single report QA') ON CONFLICT(id) DO NOTHING",[smouha,cleopatra]);});
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 async function enqueue(branch:string,text:string,key:string,user=ids.users.super_admin){const r=await runAsPersist(db,user,'select public.enqueue_cloud_report_print($1,$2,$3) r',[branch,{text,paperWidthMm:80,copies:1},key]);expect(r.error).toBeUndefined();return r.rows[0].r as {success:boolean;pages?:number;job_id:string;job_ids:string[]};}
 it('sends every character in one job for both branches, preserving cashier routing and idempotency',async()=>{
  const text=Array.from({length:60},(_,i)=>`كابتن ${i} | 12 فواتير | 100 EGP`).join('\r\n');
  for(const branch of [smouha,cleopatra]){
   const key='single:'+randomUUID();const result=await enqueue(branch,text,key);expect(result).toMatchObject({success:true,pages:1,station_code:'cashier'});expect(result.job_ids).toHaveLength(1);
   const jobs=await db.query('select id,kind,station_code,payload from public.cloud_print_jobs where branch_id=$1 and idempotency_key=$2',[branch,key]);expect(jobs.rows).toHaveLength(1);expect(jobs.rows[0]).toMatchObject({kind:'report',station_code:'cashier',payload:{text,paperWidthMm:80,copies:1}});expect(jobs.rows[0].payload.report_page).toBeUndefined();
   expect(await enqueue(branch,'changed text',key)).toMatchObject({job_id:result.job_id,deduplicated:true});
   expect((await db.query('select count(*)::int n from public.cloud_print_jobs where branch_id=$1 and idempotency_key=$2',[branch,key])).rows[0].n).toBe(1);
  }
 });
 it('does not replay or rewrite an accepted legacy root or its child pages',async()=>{
  const key='legacy:'+randomUUID();await db.query("insert into public.cloud_print_jobs(branch_id,requested_by,kind,station_code,payload,idempotency_key) values($1,$2,'report','cashier','{\"text\":\"OLD ROOT\",\"report_pages\":2}', $3),($1,$2,'report','cashier','{\"text\":\"OLD CHILD\",\"report_page\":2}', $4)",[smouha,ids.users.super_admin,key,key+':page:2']);
  const before=(await db.query('select id,payload,status,updated_at from public.cloud_print_jobs where branch_id=$1 and idempotency_key in ($2,$3) order by id',[smouha,key,key+':page:2'])).rows;
  expect(await enqueue(smouha,'NEW REPORT',key)).toMatchObject({success:true,deduplicated:true});
  expect((await db.query('select id,payload,status,updated_at from public.cloud_print_jobs where branch_id=$1 and idempotency_key in ($2,$3) order by id',[smouha,key,key+':page:2'])).rows).toEqual(before);
 });
 it('keeps permission checks and branch isolation',async()=>{
  await db.query("update public.roles set permissions=permissions-'shifts.report.shift' where role='cashier'");
  expect(await enqueue(ids.branchA,'DENIED',randomUUID(),ids.users.cashier)).toMatchObject({success:false,error:'PERMISSION_DENIED'});
  expect(await enqueue(ids.branchB,'FOREIGN',randomUUID(),ids.users.branch_manager)).toMatchObject({success:false,error:'BRANCH_MISMATCH'});
 });
 it('rehearses guarded rollback/reapply with unchanged owner, ACL, security and settings',async()=>{
  const q="select proowner,prosecdef,proacl::text,proconfig from pg_proc where oid='public.enqueue_cloud_report_print(uuid,jsonb,text)'::regprocedure";const before=(await db.query(q)).rows;
  await db.query('SAVEPOINT rollback_single_report');
  try{await db.query(readFileSync('scripts/rollback/smouha_single_report_job_20261026.sql','utf8'));expect((await db.query("select md5(pg_get_functiondef('public.enqueue_cloud_report_print(uuid,jsonb,text)'::regprocedure)) hash")).rows[0].hash).toBe('c80ad7f4acf15aeb306716b8165cf4ff');await db.query(readFileSync('supabase/migrations/20261026141124_smouha_single_report_job.sql','utf8'));expect((await db.query(q)).rows).toEqual(before);expect(await enqueue(smouha,'REAPPLIED\n'.repeat(50),randomUUID())).toMatchObject({pages:1,success:true});}finally{await db.query('ROLLBACK TO SAVEPOINT rollback_single_report');await db.query('RELEASE SAVEPOINT rollback_single_report');}
 });
});
