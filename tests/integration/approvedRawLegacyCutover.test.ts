import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { seedRlsFixture,type RlsIds } from './rls';
import { installApprovedRawWriterFixture } from './approvedRawWriterFixture';

const url=getDbUrl();
const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('bounded audited legacy raw position cutover, owned rollback only',()=>{
 let db:pg.Client,ids:RlsIds;
 const raw=randomUUID(),empty=randomUUID();
 const qty=async(material=raw)=>Number((await db.query('SELECT coalesce(sum(quantity),0) q FROM public.raw_material_batches WHERE raw_material_id=$1',[material])).rows[0].q);
 beforeAll(async()=>{
  db=openDb(url);await db.connect();await db.query('BEGIN');
  await installApprovedRawWriterFixture(db,url);
  await db.query(readFileSync('scripts/db/candidates/raw_last_price_cutover_20261104.sql','utf8'));
  await db.query(readFileSync('scripts/db/candidates/raw_last_price_count_compatibility_20261104.sql','utf8'));
  ids=await seedRlsFixture(db);
  await db.query('SELECT public.ensure_chart_of_accounts($1)',[ids.branchA]);
  await db.query('SELECT public.seed_account_mappings($1)',[ids.branchA]);
  for(const material of [raw,empty])await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Cutover raw',$3,0,true)",[material,material,ids.branchA]);
  const old=(await db.query("SELECT public._raw_remove_fifo($1,$2,$3,2,'kitchen_send','qa_legacy',$4,'QA-OLD',NULL,true) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
  expect(old.success).toBe(true);
  await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[ids.users.super_admin,JSON.stringify({sub:ids.users.super_admin,role:'authenticated'})]);
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 it('moves old shortage quantity to one aggregate without faking receipts or changing source costs/journals',async()=>{
  const before=await db.query('SELECT id,quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1 ORDER BY id',[raw]);
  const journal=(await db.query('SELECT count(*)::int n FROM public.journal_entries')).rows[0].n;
  const converted=(await db.query('SELECT private.activate_raw_last_price_coordinate($1,$2,$3,-2,1,2) r',[ids.branchA,ids.whA,raw])).rows[0].r;
  expect(converted).toMatchObject({success:true,already_active:false,converted_debts:1,shortage_quantity:2,frozen_basis:0});
  expect(await qty()).toBe(-2);
  expect((await db.query('SELECT id,quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1 ORDER BY id',[raw])).rows).toEqual(before.rows);
  expect((await db.query('SELECT count(*)::int n FROM public.journal_entries')).rows[0].n).toBe(journal);
  const debts=(await db.query('SELECT settled_quantity,approved_conversion_batch_id,approved_converted_at FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw])).rows;
  expect(debts).toHaveLength(1);expect(Number(debts[0].settled_quantity)).toBe(0);
  expect(debts[0].approved_conversion_batch_id).toBeTruthy();expect(debts[0].approved_converted_at).toBeTruthy();
  expect((await db.query("SELECT id FROM public.audit_log WHERE entity_id=$1 AND details->>'kind'='raw_last_price_coordinate_cutover'",[raw])).rows).toHaveLength(1);
 });
 it('stops new per-issue FIFO debt and recognizes only receipt-period variance without replaying old source costs',async()=>{
  const source=(await db.query('SELECT id,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1 ORDER BY id LIMIT 1',[raw])).rows;
  const issue=(await db.query("SELECT public._raw_remove_fifo($1,$2,$3,1,'kitchen_send','qa_new',$4,'QA-NEW',NULL,true) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
  expect(issue).toMatchObject({success:true,avg_cost:0,oversold:1});expect(await qty()).toBe(-3);
  expect((await db.query('SELECT count(*)::int n FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw])).rows[0].n).toBe(1);
  const receipt=(await db.query("SELECT public._raw_add($1,$2,$3,3,7,'QA-RECEIPT',NULL,NULL,'purchase_receipt','purchase_receipt',$4,'QA-RECEIPT',NULL) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
  expect(receipt.success).toBe(true);expect(Number(receipt.approved_price_variance_posted)).toBe(21);
  expect(await qty()).toBe(0);
  expect((await db.query('SELECT id,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1 ORDER BY id LIMIT 1',[raw])).rows).toEqual(source);
  expect((await db.query('SELECT id FROM public.raw_fifo_settlements WHERE debt_id IN(SELECT id FROM public.raw_fifo_debts WHERE raw_material_id=$1)',[raw])).rows).toEqual([]);
  const j=(await db.query("SELECT count(DISTINCT j.id)::int n,sum(l.debit) debit,sum(l.credit) credit FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.branch_id=$1 AND j.reference_type='approved_raw_shortage_variance'",[ids.branchA])).rows[0];
  expect(j.n).toBe(1);expect(Number(j.debit)).toBe(21);expect(Number(j.credit)).toBe(21);
  const again=(await db.query('SELECT private.activate_raw_last_price_coordinate($1,$2,$3,-2,1,2) r',[ids.branchA,ids.whA,raw])).rows[0].r;
  expect(again).toMatchObject({success:true,already_active:true});
  expect((await db.query("SELECT id FROM public.audit_log WHERE entity_id=$1 AND details->>'kind'='raw_last_price_coordinate_cutover'",[raw])).rows).toHaveLength(1);
 });
 it('rejects stale stock or missing authority before touching an unconverted coordinate',async()=>{
  await db.query('SAVEPOINT stale_cutover');
  await expect(db.query('SELECT private.activate_raw_last_price_coordinate($1,$2,$3,1,0,0)',[ids.branchA,ids.whA,empty])).rejects.toThrow('CUTOVER_STOCK_CHANGED');
  await db.query('ROLLBACK TO stale_cutover');await db.query('RELEASE stale_cutover');
  expect(await qty(empty)).toBe(0);
  expect((await db.query('SELECT id FROM public.raw_material_batches WHERE raw_material_id=$1',[empty])).rows).toEqual([]);
  expect((await db.query("SELECT has_function_privilege('authenticated','private.activate_raw_last_price_coordinate(uuid,uuid,uuid,numeric,integer,numeric)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
 });
 it('rejects reverting a converted position or repricing its archived source',async()=>{
  for (const [sql,error] of [
   ['DELETE FROM private.raw_cost_v2_activated_coordinates WHERE raw_material_id=$1','RAW_LAST_PRICE_CUTOVER_HISTORY_IMMUTABLE'],
   ['UPDATE public.raw_fifo_debts SET settled_quantity=debt_quantity WHERE raw_material_id=$1','RAW_LAST_PRICE_CUTOVER_HISTORY_IMMUTABLE'],
   ['DELETE FROM public.raw_fifo_debts WHERE raw_material_id=$1','RAW_LAST_PRICE_CUTOVER_HISTORY_IMMUTABLE'],
   ['UPDATE public.inventory_ledger SET unit_cost=100,total_cost=quantity*100 WHERE id IN(SELECT source_ledger_id FROM public.raw_fifo_debts WHERE raw_material_id=$1)','RAW_CONVERTED_SOURCE_COST_IMMUTABLE'],
  ]) {
   await db.query('SAVEPOINT immutable_cutover');
   await expect(db.query(sql,[raw])).rejects.toThrow(error);
   await db.query('ROLLBACK TO immutable_cutover');await db.query('RELEASE immutable_cutover');
  }
  expect(await qty()).toBe(0);
  expect((await db.query('SELECT private.raw_last_price_enabled($1,$2,$3) active',[ids.branchA,ids.whA,raw])).rows[0].active).toBe(true);
 });
 it('applies a later physical count after an approved shortage without resurrecting archived debts',async()=>{
  const issued=(await db.query("SELECT public._raw_remove_fifo($1,$2,$3,2,'kitchen_send','qa_after_cutover',$4,'QA-COUNT-SOURCE',NULL,true) r",[raw,ids.branchA,ids.whA,randomUUID()])).rows[0].r;
  expect(issued.success).toBe(true);expect(await qty()).toBe(-2);
  const count=randomUUID();
  await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_at,created_by,approved_by,approved_at) VALUES($1,$2,$3,$4,'approved','partial',clock_timestamp(),$5,$5,clock_timestamp())",[count,'CUTOVER-COUNT-'+count,ids.branchA,ids.whA,ids.users.super_admin]);
  await db.query('INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,-2,0,0)',[count,raw]);
  const posted=(await db.query('SELECT public.apply_stock_count($1) r',[count])).rows[0].r;
  expect(posted.success,JSON.stringify(posted)).toBe(true);
  expect(await qty()).toBe(0);
  expect((await db.query('SELECT id FROM public.raw_fifo_debts WHERE raw_material_id=$1 AND approved_converted_at IS NULL',[raw])).rows).toEqual([]);
  const retry=(await db.query('SELECT public.apply_stock_count($1) r',[count])).rows[0].r;
  expect(retry.success).toBe(false);expect(await qty()).toBe(0);
 });
});
