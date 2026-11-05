import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { runAs,seedRlsFixture,type RlsIds } from './rls';
import type { PeriodCloseRaw,PeriodCloseMovements } from '../../src/api/domains/reporting';
const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('period close historical balance and evidence — owned localhost',()=>{
 let db:pg.Client;let ids:RlsIds;const raw=randomUUID(),zero=randomUUID(),count=randomUUID();
 beforeAll(async()=>{
  db=openDb(url!);await db.connect();await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='8s'");ids=await seedRlsFixture(db);
  await db.query(`UPDATE public.roles SET permissions=permissions || '["reports.view","reports.costing","reports.financial","history.unlimited"]'::jsonb WHERE role IN ('branch_manager','owner')`);
  for(const id of [raw,zero]) await db.query('INSERT INTO public.raw_materials(id,branch_id,code,name,default_cost) VALUES($1,$2,$3,$4,0)',[id,ids.branchA,randomUUID(),'Period balance '+id]);
  await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,12.5,'PERIOD-PRICE',clock_timestamp())`,[raw,ids.branchA]);
  await db.query(`INSERT INTO public.stock_counts(id,branch_id,warehouse_id,status,count_type,count_number,created_at) VALUES($1,$2,$3,'approved','full',$4,'2026-10-01 12:00'::timestamp AT TIME ZONE 'Africa/Cairo')`,[count,ids.branchA,ids.whA,randomUUID()]);
  await db.query('INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,10,999,12.5)',[count,raw]);
  for(const [date,qty,type,ref] of [['2026-09-30 23:59:59',10,'adjustment','opening'],['2026-10-01 00:00:00',4,'purchase','purchase'],['2026-10-01 12:00:00',-3,'sale','sale'],['2026-10-31 23:59:59',-2,'transfer_out','warehouse_transfer'],['2026-11-01 00:00:00',100,'adjustment','opening']] as const) {
   await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number,created_at) VALUES($1,$2,$3,$4,1,$4,$5,$6,$7,$8,$9::timestamp AT TIME ZONE 'Africa/Cairo')`,[raw,ids.branchA,ids.whA,qty,type,ref,ref==='purchase'?ids.purchA:ref==='sale'?ids.saleA:null,randomUUID(),date]);
  }
  await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,batch_number,created_at) VALUES($1,$2,$3,2,0,0,'adjustment','opening',$4,'2026-09-30 12:00'::timestamp AT TIME ZONE 'Africa/Cairo')`,[zero,ids.branchA,ids.whA,randomUUID()]);
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 async function report(user=ids.users.owner,branch=ids.branchA,from='2026-10-01',to='2026-10-31') {return runAs(db,user,'SELECT public.get_period_close_raw_report($1,$2,$3) r',[branch,from,to]);}
 function value(r:Awaited<ReturnType<typeof report>>){expect(r.error).toBeUndefined();return r.rows[0].r as PeriodCloseRaw;}
 it('uses effective Cairo day boundaries, ignoring unapplied counts and subsequent movements',async()=>{
  const result=value(await report());expect(result).toMatchObject({opening_complete:true,closing_complete:true});
  expect(result.materials?.find(m=>m.id===raw)).toMatchObject({opening:10,closing:9,purchase:4,transfer:-2,price:12.5,other:-3});
  expect(result.materials?.find(m=>m.id===zero)).toMatchObject({opening:2,closing:2,price:0,source:'catalog_zero'});
  for(const m of result.materials??[]) expect(m.closing).toBeCloseTo((m.opening??0)+m.purchase+m.transfer+(m.adjustment??0)+(m.other??0),8);
 });
 it('reconciles all paginated purchase/transfer evidence with summary latest-price totals',async()=>{
  const result=value(await report());
  for(const kind of ['purchase','transfer'] as const){const r=await runAs(db,ids.users.owner,'SELECT public.get_period_close_raw_movements($1,$2,$3,$4,$5,0,1) r',[ids.branchA,'2026-10-01','2026-10-31',kind,raw]);expect(r.error).toBeUndefined();const detail=r.rows[0].r as PeriodCloseMovements;expect(detail.total).toBe(result.materials!.find(m=>m.id===raw)![kind]*12.5);expect(detail.rows).toHaveLength(1);expect(detail.rows[0].price).toBe(12.5);}
 });
 it('positions an applied midday count adjustment at its creation time without rewriting midnight',async()=>{
  await db.query('SAVEPOINT applied_count');
  try {
   await db.query("UPDATE public.stock_counts SET status='applied',applied_at=now() WHERE id=$1",[count]);
   await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number,created_at) VALUES($1,$2,$3,7,12.5,87.5,'adjustment','stock_count',$4,$5,'2026-10-01 12:00'::timestamp AT TIME ZONE 'Africa/Cairo')`,[raw,ids.branchA,ids.whA,count,randomUUID()]);
   expect(value(await report()).materials?.find(m=>m.id===raw)).toMatchObject({opening:10,closing:16,adjustment:7});
  } finally {await db.query('ROLLBACK TO SAVEPOINT applied_count');}
 });
 it('accepts one day and respects branch/permission/date bounds',async()=>{
  expect(value(await report(undefined,undefined,'2026-10-01','2026-10-01')).materials?.find(m=>m.id===raw)).toMatchObject({opening:10,closing:11});
  expect((await report(ids.users.branch_manager,ids.branchB)).error).toBe('BRANCH_ACCESS_DENIED');
  expect((await report(ids.users.cashier)).error).toContain('PERMISSION_DENIED');
  expect((await report(undefined,undefined,'2026-10-02','2026-10-01')).error).toBe('INVALID_REPORT_PERIOD');
 });
 it('retains physical quantities from unreadable invoices but hides their document references',async()=>{
  await db.query('SAVEPOINT hide_invoice');
  try{
   const hidden=randomUUID(); // Unknown invoice is not readable through the canonical predicate.
   await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,reference_number,batch_number,created_at) VALUES($1,$2,$3,500,1,500,'purchase','purchase',$4,'HIDDEN-INVOICE',$5,'2026-10-02 12:00'::timestamp AT TIME ZONE 'Africa/Cairo')`,[raw,ids.branchA,ids.whA,hidden,randomUUID()]);
   const result=value(await report());expect(result.materials?.find(m=>m.id===raw)?.purchase).toBe(504);
   const detail=await runAs(db,ids.users.owner,'SELECT public.get_period_close_raw_movements($1,$2,$3,$4,$5,0,50) r',[ids.branchA,'2026-10-01','2026-10-31','purchase',raw]);
   expect(detail.error).toBeUndefined();expect((detail.rows[0].r as PeriodCloseMovements).count).toBe(2);expect((detail.rows[0].r as PeriodCloseMovements).rows.find(row=>row.quantity===500)?.reference_number).toBeNull();

  }finally{await db.query('ROLLBACK TO SAVEPOINT hide_invoice');}
 });
 it('retains historical date bounds for limited users while stock stays physical',async()=>{
  await db.query('SAVEPOINT limited_history');
  try {
   await db.query("UPDATE public.roles SET permissions=permissions-'history.unlimited' WHERE role='owner'");
   const r=await runAs(db,ids.users.owner,"SELECT public.get_period_close_raw_report($1,CURRENT_DATE,CURRENT_DATE) r",[ids.branchA]);
   const result=value(r);
   const canonical=await db.query(`SELECT coalesce(sum(l.quantity),0)::float8 qty FROM public.inventory_ledger l WHERE l.branch_id=$1 AND l.raw_material_id=$2 AND l.created_at<CURRENT_DATE::timestamp AT TIME ZONE 'Africa/Cairo'`,[ids.branchA,raw]);
   expect(result.materials?.find(m=>m.id===raw)?.opening??0).toBe(canonical.rows[0].qty);
   expect((await report(undefined,undefined,'2026-10-01','2027-02-01')).error).toBe('INVALID_REPORT_PERIOD');
  } finally {await db.query('ROLLBACK TO SAVEPOINT limited_history');}
 });
});
