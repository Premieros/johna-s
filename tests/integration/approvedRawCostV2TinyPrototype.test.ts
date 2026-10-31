import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// Max 2 shortage issues + 2 receipts + 1 positive issue. No 717-row
// simulation, no persistent source data, never a Supabase production write.
const url=getDbUrl();
let disposable=false;
try {
  const host=new URL(url).hostname;
  disposable=['localhost','127.0.0.1','[::1]'].includes(host);
} catch { /* local PostgreSQL unavailable */ }

describe.skipIf(!disposable)('approved-cost v2 minimal-storage internal prototype',()=>{
  let db:pg.Client;
  const branch=randomUUID(),warehouse=randomUUID(),raw=randomUUID();
  const newRef=()=>randomUUID();
  async function q<T>(sql:string,params:unknown[]=[]){
    return (await db.query<T & pg.QueryResultRow>(sql,params)).rows;
  }
  async function whQty(){
    const r=await q<{qty:string}>(
      'SELECT COALESCE(sum(quantity),0)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1 AND warehouse_id=$2',
      [raw,warehouse]
    );
    return Number(r[0].qty);
  }
  async function legacyDebts(){
    const r=await q<{n:number}>(
      'SELECT count(*)::int n FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw]);
    return r[0].n;
  }
  beforeAll(async()=>{
    db=openDb(url);await db.connect();await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Approved price v2 tiny fixture')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Approved cost QA',$2,true,true)",[warehouse,branch]);
    await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
    await db.query('SELECT public.seed_account_mappings($1)',[branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Approved-cost QA raw',$3,0,true)",[raw,'AC-'+raw,branch]);

    const schema=readFileSync(
      'scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql','utf8'
    ).replace(/^([\s\S]*?)BEGIN;\s*/,'').replace(/\s*COMMIT;\s*$/,'');
    await db.query(schema);
    await db.query(readFileSync(
      'scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql','utf8'
    ));
  },60000);
  afterAll(async()=>{
    if(db){try{await db.query('ROLLBACK');}finally{await db.end();}}
  });
  async function issue(n:number){
    const r=await q<{result:{success:boolean,error?:string,avg_cost?:number,oversold?:number,approved_price_source?:string}}>(
      "SELECT private.raw_issue_approved_v2($1,$2,$3,$4,'production','production',$5,'QA-ISSUE',NULL) result",
      [raw,branch,warehouse,n,newRef()]);
    return r[0].result;
  }
  async function receive(n:number,cost:number) {
    const r=await q<{result:{success:boolean,error?:string,approved_price_variance_posted?:number,approved_shortage_absorbed?:number}}>(
      "SELECT private.raw_receive_approved_v2($1,$2,$3,$4,$5,'purchase','receipt',$6,'QA-RECEIPT',NULL) result",
      [raw,branch,warehouse,n,cost,newRef()]);
    return r[0].result;
  }
  it('never guesses a cost when no approved price exists',async()=>{
    const r=await issue(2);
    expect(r).toMatchObject({success:false,error:'APPROVED_RAW_PRICE_UNAVAILABLE'});
    expect(await whQty()).toBe(0);
    expect(await legacyDebts()).toBe(0);
  });
  it('freezes as-of approved price, aggregates shortages without FIFO debts, and journals only net receipt differences',async()=>{
    await db.query(
      "INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,1200,'pricing','P1200',clock_timestamp())",
      [raw,branch]
    );
    const first=await issue(2.5);
    expect(first).toMatchObject({success:true,avg_cost:1200,oversold:2.5,approved_price_source:'pricing'});
    expect(await whQty()).toBeCloseTo(-2.5,5);
    expect(await legacyDebts()).toBe(0);

    await db.query(
      "INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,1300,'pricing','P1300',clock_timestamp()+interval '1 millisecond')",
      [raw,branch]
    );
    // Use an approved event in the past, not a future cost source.
    await db.query(
      "UPDATE public.raw_material_price_events SET priced_at=clock_timestamp()-interval '1 millisecond' WHERE reference_number='P1300' AND raw_material_id=$1",
      [raw]
    );
    const second=await issue(1);
    expect(second).toMatchObject({success:true,avg_cost:1300,oversold:1});
    expect(await whQty()).toBeCloseTo(-3.5,5);
    const shortage=await q<{quantity:string,basis:string,cnt:number}>(
      `SELECT quantity::text,approved_shortage_total_cost::text basis,
        (SELECT count(*)::int FROM public.raw_material_batches WHERE raw_material_id=$1 AND source_type='approved_shortage_aggregate') cnt
       FROM public.raw_material_batches WHERE raw_material_id=$1 AND source_type='approved_shortage_aggregate'`,
      [raw]
    );
    expect(shortage[0].cnt).toBe(1);
    expect(Number(shortage[0].basis)).toBeCloseTo(4300,4);
    expect(await legacyDebts()).toBe(0);
    const ledger=await q<{unit_cost:string,approved_price_ref:string,approved_cost_basis:string}>(
      "SELECT unit_cost::text,approved_price_ref,approved_cost_basis FROM public.inventory_ledger WHERE raw_material_id=$1 AND quantity<0 ORDER BY id",[raw]
    );
    expect(ledger).toHaveLength(2);
    expect(ledger.map(x=>Number(x.unit_cost))).toEqual([1200,1300]);
    expect(ledger.map(x=>x.approved_price_ref)).toEqual(['P1200','P1300']);
    expect(ledger.every(x=>x.approved_cost_basis==='approved_last_known')).toBe(true);

    const received=await receive(2,1400);
    expect(received.success).toBe(true);
    expect(Number(received.approved_shortage_absorbed)).toBeCloseTo(2,6);
    expect(Number(received.approved_price_variance_posted)).toBeCloseTo(342.86,2);
    expect(await whQty()).toBeCloseTo(-1.5,5);
    const secondReceived=await receive(3,1400);
    expect(secondReceived.success).toBe(true);
    expect(Number(secondReceived.approved_shortage_absorbed)).toBeCloseTo(1.5,6);
    expect(await whQty()).toBeCloseTo(1.5,5);
    expect(await legacyDebts()).toBe(0);

    const journals=await q<{id:string,debits:string,credits:string}>(
      `SELECT j.id,sum(l.debit)::text debits,sum(l.credit)::text credits
       FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
       WHERE j.reference_type='approved_raw_shortage_variance' AND j.branch_id=$1
       GROUP BY j.id ORDER BY j.id`,[branch]
    );
    expect(journals).toHaveLength(2);
    for(const j of journals) {
      expect(Number(j.debits)).toBeGreaterThan(0);
      expect(Number(j.debits)).toBeCloseTo(Number(j.credits),2);
    }
    const out=await issue(1);
    expect(out).toMatchObject({success:true,avg_cost:1300,oversold:0});
    expect(await whQty()).toBeCloseTo(0.5,5);
    expect(await legacyDebts()).toBe(0);
    const movements=await q<{n:number}>(`
      SELECT count(*)::int n FROM public.inventory_ledger
      WHERE raw_material_id=$1 AND approved_cost_basis='approved_last_known'
    `,[raw]);
    expect(movements[0].n).toBe(3);
  },30000);
});
