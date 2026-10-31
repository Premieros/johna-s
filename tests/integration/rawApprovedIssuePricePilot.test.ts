import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, uniq, type RlsIds } from './rls';

const url=getDbUrl();
let local=false;
try { const u=new URL(url); local=['localhost','127.0.0.1','[::1]'].includes(u.hostname) && ['postgres:','postgresql:'].includes(u.protocol); }
catch { /* no disposable DB */ }
const candidate=readFileSync('scripts/db/candidates/raw_approved_price_issue_pilot_20261031.sql','utf8');

describe.skipIf(!local)('approved issue pricing pilot: frozen historical cost, tracked variance',()=>{
  let db:pg.Client;
  let ids:RlsIds;
  let raw:string;
  let noPriceRaw:string;
  beforeAll(async()=>{
    db=openDb(url);await db.connect();await db.query('BEGIN');
    ids=await seedRlsFixture(db);
    await db.query(candidate); // transaction-scoped pilot, never installed on live data
    raw=(await db.query<{id:string}>(
      "INSERT INTO public.raw_materials (code,name,branch_id,default_cost,is_active) VALUES ($1,'Approved issue pilot',$2,0,true) RETURNING id",
      [uniq('APPROVED-ISSUE'),ids.branchA])).rows[0].id;
    noPriceRaw=(await db.query<{id:string}>(
      "INSERT INTO public.raw_materials (code,name,branch_id,default_cost,is_active) VALUES ($1,'Unpriced issue pilot',$2,0,true) RETURNING id",
      [uniq('UNPRICED-ISSUE'),ids.branchA])).rows[0].id;
    await db.query(
      "INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES ($1,$2,1200,'pricing',$3,clock_timestamp())",
      [raw,ids.branchA,uniq('PRICE-INITIAL')]);
    const price=await db.query<{unit_cost:string,price_source:string}>(
      'SELECT unit_cost,price_source FROM public.get_raw_material_current_prices($1,ARRAY[$2::uuid])',[ids.branchA,raw]);
    expect(Number(price.rows[0]?.unit_cost)).toBe(1200);
    expect(price.rows[0]?.price_source).toBe('pricing');
  },60000);
  afterAll(async()=>{
    if(db){try{await db.query('ROLLBACK')}finally{await db.end()}}
  });
  async function issue(rawId:string,qty:number,ref=randomUUID()){
    const r=(await db.query<{result:{success:boolean,avg_cost?:number,oversold?:number}}>(
      "SELECT public._raw_remove_fifo($1,$2,$3,$4,'transfer','warehouse_transfer',$5,$6,NULL,true) result",
      [rawId,ids.branchA,ids.whA,qty,ref,uniq('ISSUE')])).rows[0].result;
    expect(r.success,JSON.stringify(r)).toBe(true);
    const debt=(await db.query<{id:string,source_ledger_id:string,debt_quantity:string}>(
      'SELECT id,source_ledger_id,debt_quantity FROM public.raw_fifo_debts WHERE reference_id=$1',[ref])).rows[0];
    const ledger=(await db.query<{quantity:string,unit_cost:string,total_cost:string}>(
      'SELECT quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE id=$1',[debt.source_ledger_id])).rows[0];
    return {ref, debt, ledger, result:r};
  }
  async function receipt(rawId:string,qty:number,cost:number,ref=randomUUID()){
    const r=(await db.query<{result:{success:boolean,detail?:string}}>(
      "SELECT public._raw_add($1,$2,$3,$4,$5,NULL,NULL,NULL,'receipt','purchase_receipt',$6,$7,NULL) result",
      [rawId,ids.branchA,ids.whA,qty,cost,ref,uniq('RECEIPT')])).rows[0].result;
    expect(r.success,JSON.stringify(r)).toBe(true);
    return ref;
  }
  it('freezes last approved price on a negative raw issue instead of recording zero',async()=>{
    const {debt,ledger,result}=await issue(raw,2.86);
    expect(Number(ledger.unit_cost)).toBeCloseTo(1200,4);
    expect(Number(ledger.total_cost)).toBeCloseTo(-3432,4);
    expect(Number(result.avg_cost)).toBeCloseTo(1200,2);
    const snap=(await db.query<{approved_unit_cost:string,price_source:string,source_ledger_id:string}>(
      'SELECT approved_unit_cost,price_source,source_ledger_id FROM private.raw_approved_negative_issue_snapshots WHERE debt_id=$1',[debt.id])).rows;
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({price_source:'pricing',source_ledger_id:String(debt.source_ledger_id)});
    expect(Number(snap[0].approved_unit_cost)).toBe(1200);
    const totalBefore=Number(ledger.total_cost);
    await receipt(raw,2.86,1200);
    const row=(await db.query<{total_cost:string}>('SELECT total_cost FROM public.inventory_ledger WHERE id=$1',[debt.source_ledger_id])).rows[0];
    expect(Number(row.total_cost)).toBeCloseTo(totalBefore,4);
    const variance=(await db.query<{difference_amount:string,journal_status:string}>(
      'SELECT difference_amount,journal_status FROM private.raw_approved_cost_variances WHERE source_ledger_id=$1',[debt.source_ledger_id])).rows;
    expect(variance).toHaveLength(1);
    expect(Number(variance[0].difference_amount)).toBe(0);
    expect(variance[0].journal_status).toBe('posted');
    expect(Number((await db.query('SELECT settled_quantity FROM public.raw_fifo_debts WHERE id=$1',[debt.id])).rows[0].settled_quantity)).toBeCloseTo(2.86,4);
  });
  it('preserves frozen issue price when the receipt price differs, recording every unposted variance',async()=>{
    const {debt,ledger}=await issue(raw,1.5);
    await db.query(
      "INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES ($1,$2,1350,'pricing',$3,clock_timestamp())",
      [raw,ids.branchA,uniq('PRICE-REVISED')]);
    await receipt(raw,1.5,1350);
    const after=(await db.query<{unit_cost:string,total_cost:string}>(
      'SELECT unit_cost,total_cost FROM public.inventory_ledger WHERE id=$1',[debt.source_ledger_id])).rows[0];
    expect(Number(after.unit_cost)).toBeCloseTo(Number(ledger.unit_cost),4);
    expect(Number(after.total_cost)).toBeCloseTo(Number(ledger.total_cost),4);
    const variance=(await db.query<{difference_amount:string,quantity:string,approved_unit_cost:string,receipt_unit_cost:string,journal_status:string,journal_entry_id:string}>(
      'SELECT * FROM private.raw_approved_cost_variances WHERE source_ledger_id=$1',[debt.source_ledger_id])).rows[0];
    expect(Number(variance.quantity)).toBeCloseTo(1.5,4);
    expect(Number(variance.approved_unit_cost)).toBeCloseTo(1200,4);
    expect(Number(variance.receipt_unit_cost)).toBeCloseTo(1350,4);
    expect(Number(variance.difference_amount)).toBeCloseTo(225,4);
    expect(variance.journal_status).toBe('posted');
    expect(variance.journal_entry_id).toBeTruthy();
    const journal=(await db.query<{account_id:string,debit:string,credit:string}>(
      'SELECT account_id,debit,credit FROM public.journal_entry_lines WHERE journal_entry_id=$1',
      [variance.journal_entry_id])).rows;
    expect(journal).toHaveLength(2);
    expect(journal.reduce((sum,row)=>sum+Number(row.debit),0)).toBeCloseTo(225,2);
    expect(journal.reduce((sum,row)=>sum+Number(row.credit),0)).toBeCloseTo(225,2);
    const varianceAccount=(await db.query(
      "SELECT account_id FROM public.account_mappings WHERE branch_id=$1 AND semantic_key='stock_variance'",
      [ids.branchA])).rows[0].account_id;
    expect(Number(journal.find(row=>row.account_id===varianceAccount)?.debit)).toBeCloseTo(225,2);
    const before=(await db.query<{n:string}>(
      "SELECT COUNT(*)::text n FROM public.journal_entries WHERE reference_type='raw_approved_receipt_variance'"
    )).rows[0].n;
    // A repeated receipt cannot post another journal.
    const settlement=(await db.query<{receipt_ledger_id:string,receipt_batch_id:string}>(
      'SELECT receipt_ledger_id,receipt_batch_id FROM public.raw_fifo_settlements WHERE debt_id=$1',[debt.id])).rows[0];
    const repeated=(await db.query<{r:{success:boolean,settled_quantity:number}}>(
      'SELECT public._raw_fifo_settle_receipt($1,$2,NULL) r',[settlement.receipt_ledger_id,settlement.receipt_batch_id])).rows[0].r;
    expect(repeated).toMatchObject({success:true});
    expect(Number(repeated.settled_quantity)).toBe(0);
    expect(Number((await db.query(
      "SELECT COUNT(*)::int n FROM public.journal_entries WHERE reference_type='raw_approved_receipt_variance'"
    )).rows[0].n)).toBe(Number(before));
  });
  it('retains legacy unpriced debt treatment without falsely claiming an approved price',async()=>{
    const {debt,ledger}=await issue(noPriceRaw,1.25);
    expect(Number(ledger.unit_cost)).toBe(0);
    expect(Number(ledger.total_cost)).toBe(0);
    const s=await db.query('SELECT 1 FROM private.raw_approved_negative_issue_snapshots WHERE debt_id=$1',[debt.id]);
    expect(s.rowCount).toBe(0);
  });
  it('does not grant application users direct access to private cost ledgers',async()=>{
    for(const name of ['raw_approved_negative_issue_snapshots','raw_approved_cost_variances']){
      const r=(await db.query<{anon:boolean,authenticated:boolean,service:boolean}>(
        "SELECT has_table_privilege('anon',$1::regclass,'SELECT') anon,has_table_privilege('authenticated',$1::regclass,'SELECT') authenticated,has_table_privilege('service_role',$1::regclass,'SELECT') service",
        ['private.'+name])).rows[0];
      expect(r).toEqual({anon:false,authenticated:false,service:false});
    }
  });
});
