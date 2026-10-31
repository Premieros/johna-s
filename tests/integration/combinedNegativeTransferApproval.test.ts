import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, uniq, type RlsIds } from './rls';

// Real RPC + FIFO exercise, confined to a disposable localhost/CI PostgreSQL
// transaction which is *always* rolled back; never runs against production.
const url=getDbUrl();
let local=false;
try { local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname); }
catch { /* no disposable database */ }

describe.skipIf(!local)('combined preview approval with negative warehouse FIFO',()=>{
 let client: pg.Client;
 let ids: RlsIds;
 let rawId='';
 let receivingWh='';
 let transfer='';
 let lineId='';
 let originalLedger=0;
 let originalDebt=0;
 let baselineUnbalanced=0;
 let baselineJournalLines=0;
 const stock=async(wh:string)=>Number((await client.query(
   'SELECT COALESCE(quantity,0)::numeric AS q FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
   [rawId,ids.branchA,wh])).rows[0]?.q ?? 0);
 const snapshot=()=>[{id:lineId,raw_material_id:rawId,destination_raw_material_id:rawId,product_id:null,quantity:2.86}];
 beforeAll(async()=>{
  client=openDb(url);await client.connect();await client.query('BEGIN');
  ids=await seedRlsFixture(client);
  await client.query("SELECT set_config('app.user_id',$1,true)",[ids.users.super_admin]);
  receivingWh=(await client.query<{id:string}>(
    "INSERT INTO public.warehouses (name,branch_id,is_active) VALUES ($1,$2,true) RETURNING id",
    [uniq('target-wh'),ids.branchA])).rows[0].id;
  rawId=(await client.query<{id:string}>(
    "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'Negative-FIFO-probe',$2,true) RETURNING id",
    [uniq('negative-probe'),ids.branchA])).rows[0].id;
  transfer=(await client.query<{id:string}>(
    "INSERT INTO public.warehouse_transfers (transfer_number,branch_id,to_branch_id,from_warehouse_id,to_warehouse_id,requested_by) VALUES ($1,$2,$2,$3,$4,$5) RETURNING id",
    [uniq('safe-transfer'),ids.branchA,ids.whA,receivingWh,ids.users.super_admin])).rows[0].id;
  lineId=(await client.query<{id:string}>(
    "INSERT INTO public.warehouse_transfer_items (transfer_id,raw_material_id,destination_raw_material_id,quantity,unit_cost) VALUES ($1,$2,$2,2.86,0) RETURNING id",
    [transfer,rawId])).rows[0].id;
  originalLedger=Number((await client.query('SELECT COUNT(*)::int n FROM public.inventory_ledger')).rows[0].n);
  originalDebt=Number((await client.query('SELECT COUNT(*)::int n FROM public.raw_fifo_debts')).rows[0].n);
  baselineUnbalanced=Number((await client.query(`
    SELECT COUNT(*)::int n FROM (
      SELECT je.id FROM public.journal_entries je
      JOIN public.journal_entry_lines line ON line.journal_entry_id=je.id
      GROUP BY je.id HAVING ABS(SUM(CASE WHEN line.debit>0 THEN line.debit ELSE -line.credit END))>0.000001
    ) bad`)).rows[0].n);
  baselineJournalLines=Number((await client.query('SELECT COUNT(*)::int n FROM public.journal_entry_lines')).rows[0].n);
 });
 afterAll(async()=>{if(client){try{await client.query('ROLLBACK')}finally{await client.end()}}});
 const approve=async(expected:unknown[])=> (await client.query<{r:{success:boolean,error?:string}}>(
  'SELECT public.approve_previewed_warehouse_transfer($1,$2::jsonb) r',
  [transfer,JSON.stringify(expected)])).rows[0].r;
 it('rejects stale reviewed item snapshots without posting any inventory',async()=>{
  expect((await approve([{...snapshot()[0],quantity:20}])).error).toBe('TRANSFER_ITEMS_CHANGED');
  expect(await stock(ids.whA)).toBe(0);
  expect(Number((await client.query('SELECT COUNT(*)::int n FROM public.inventory_ledger')).rows[0].n)).toBe(originalLedger);
 });
 it('approves above available stock, creates traceable OV debt, and adds destination stock once',async()=>{
  const result=await approve(snapshot());
  expect(result).toMatchObject({success:true});
  expect(await stock(ids.whA)).toBeCloseTo(-2.86,4);
  expect(await stock(receivingWh)).toBeCloseTo(2.86,4);
  const debts=(await client.query<{debt_quantity:string,reference_type:string,warehouse_id:string}>(
   "SELECT debt_quantity,reference_type,warehouse_id FROM public.raw_fifo_debts WHERE reference_id=$1",
   [transfer])).rows;
  expect(debts).toHaveLength(1);
  expect(Number(debts[0].debt_quantity)).toBeCloseTo(2.86,4);
  expect(debts[0].warehouse_id).toBe(ids.whA);
  expect(debts[0].reference_type).toBe('warehouse_transfer');
  expect(Number((await client.query('SELECT COUNT(*)::int n FROM public.raw_fifo_debts')).rows[0].n)).toBe(originalDebt+1);
  expect((await approve(snapshot())).error).toBe('INVALID_STATUS');
  expect(await stock(ids.whA)).toBeCloseTo(-2.86,4);
  expect(await stock(receivingWh)).toBeCloseTo(2.86,4);
 });
 it('settles source FIFO debt on later positive receipt and adjusts same-branch destination cost',async()=>{
  const receipt=(await client.query<{r:{success:boolean,error?:string,detail?:string}}>(
   "SELECT public._raw_add($1,$2,$3,2.86,75,NULL,NULL,NULL,'purchase','purchase',$4,$5,$6) r",
   [rawId,ids.branchA,ids.whA,ids.purchA,uniq('CI-RECEIPT'),ids.users.super_admin])).rows[0].r;
  expect(receipt).toMatchObject({success:true});
  const debtor=(await client.query<{debt_quantity:string,settled_quantity:string}>(
   "SELECT debt_quantity,settled_quantity FROM public.raw_fifo_debts WHERE reference_id=$1",[transfer])).rows[0];
  expect(Number(debtor.settled_quantity)).toBeCloseTo(Number(debtor.debt_quantity),4);
  expect(await stock(ids.whA)).toBeCloseTo(0,4);
  expect(await stock(receivingWh)).toBeCloseTo(2.86,4);
  const outbound=(await client.query<{unit_cost:string,total_cost:string}>(
   "SELECT unit_cost,total_cost FROM public.inventory_ledger WHERE reference_type='warehouse_transfer' AND reference_id=$1 AND raw_material_id=$2 AND warehouse_id=$3 AND quantity<0 ORDER BY id DESC LIMIT 1",
   [transfer,rawId,ids.whA])).rows[0];
  const inbound=(await client.query<{unit_cost:string,total_cost:string}>(
   "SELECT unit_cost,total_cost FROM public.inventory_ledger WHERE reference_type='warehouse_transfer' AND reference_id=$1 AND raw_material_id=$2 AND warehouse_id=$3 AND quantity>0 ORDER BY id DESC LIMIT 1",
   [transfer,rawId,receivingWh])).rows[0];
  expect(Number(outbound.total_cost)).toBeCloseTo(-214.5,2);
  expect(Number(inbound.total_cost)).toBeCloseTo(214.5,2);
 });
 it('supports cross-branch negative source and settles receiver FIFO debt',async()=>{
  const src=(await client.query<{id:string}>(
   "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'Cross negative source',$2,true) RETURNING id",
   [uniq('src-cross'),ids.branchA])).rows[0].id;
  const dst=(await client.query<{id:string}>(
   "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'Cross negative source',$2,true) RETURNING id",
   [uniq('dst-cross'),ids.branchB])).rows[0].id;
  const prior=(await client.query<{r:{success:boolean}}>(
   "SELECT public._raw_remove_fifo($1,$2,$3,1.25,'kitchen_send','kitchen_send',$4,$5,$6,true) r",
   [dst,ids.branchB,ids.whB,ids.saleB,uniq('CI-DEBT'),ids.users.super_admin])).rows[0].r;
  expect(prior).toMatchObject({success:true});
  const tx=(await client.query<{id:string}>(
   "INSERT INTO public.warehouse_transfers (transfer_number,branch_id,to_branch_id,from_warehouse_id,to_warehouse_id,requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
   [uniq('cross-transfer'),ids.branchA,ids.branchB,ids.whA,ids.whB,ids.users.super_admin])).rows[0].id;
  const item=(await client.query<{id:string}>(
   "INSERT INTO public.warehouse_transfer_items (transfer_id,raw_material_id,destination_raw_material_id,quantity,unit_cost) VALUES ($1,$2,$3,2.86,0) RETURNING id",
   [tx,src,dst])).rows[0].id;
  const reviewed=[{id:item,raw_material_id:src,destination_raw_material_id:dst,product_id:null,quantity:2.86}];
  const approved=(await client.query<{r:{success:boolean,error?:string,detail?:string}}>(
   'SELECT public.approve_previewed_warehouse_transfer($1,$2::jsonb) r',
   [tx,JSON.stringify(reviewed)])).rows[0].r;
  expect(approved).toMatchObject({success:true});
  const sender=Number((await client.query(
   'SELECT COALESCE(quantity,0) q FROM public.raw_material_warehouse_inventory WHERE branch_id=$1 AND warehouse_id=$2 AND raw_material_id=$3',
   [ids.branchA,ids.whA,src])).rows[0]?.q??0);
  const receiver=Number((await client.query(
   'SELECT COALESCE(quantity,0) q FROM public.raw_material_warehouse_inventory WHERE branch_id=$1 AND warehouse_id=$2 AND raw_material_id=$3',
   [ids.branchB,ids.whB,dst])).rows[0]?.q??0);
  expect(sender).toBeCloseTo(-2.86,4);
  expect(receiver).toBeCloseTo(1.61,4);
  const debt=(await client.query<{debt_quantity:string,settled_quantity:string}>(
   "SELECT debt_quantity,settled_quantity FROM public.raw_fifo_debts WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3",
   [dst,ids.branchB,ids.whB])).rows;
  expect(debt).toHaveLength(1);
  expect(Number(debt[0].settled_quantity)).toBeCloseTo(1.25,4);
  expect(Number((await client.query(
   "SELECT COUNT(*)::int n FROM private.raw_transfer_receipt_prices WHERE transfer_id=$1",
   [tx])).rows[0].n)).toBe(1);
 });
 it('never permits revision of approved line and keeps accounting balanced',async()=>{
  const response=(await client.query<{r:{success:boolean,error?:string}}>(
   'SELECT public.revise_pending_warehouse_transfer($1,$2::jsonb,$3::jsonb) r',
   [transfer,JSON.stringify([{id:lineId,quantity:2.86}]),JSON.stringify([{id:lineId,quantity:5}])]
  )).rows[0].r;
  expect(response.error).toBe('INVALID_STATUS');
  const unbalanced=await client.query<{n:string}>(`
    SELECT COUNT(*)::text n FROM (
      SELECT je.id FROM public.journal_entries je
      JOIN public.journal_entry_lines line ON line.journal_entry_id=je.id
      GROUP BY je.id HAVING ABS(SUM(CASE WHEN line.debit>0 THEN line.debit ELSE -line.credit END))>0.000001
    ) bad`);
  expect(Number(unbalanced.rows[0].n)).toBe(baselineUnbalanced);
  expect(Number((await client.query('SELECT COUNT(*)::int n FROM public.journal_entry_lines')).rows[0].n)).toBe(baselineJournalLines);
 });
});
