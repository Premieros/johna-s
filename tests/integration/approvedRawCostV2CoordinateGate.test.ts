import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// Small disposable database fixture: two materials and at most three movements.
// NEVER run against Supabase production. Always ROLLBACK.
const url=getDbUrl();
let disposable=false;
try { disposable=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname); }
catch { /* unavailable */ }
function innerCandidate(path:string){
  return readFileSync(path,'utf8')
    .replace(/^[\s\S]*?BEGIN;\s*/,'').replace(/\s*COMMIT;\s*$/,'');
}
describe.skipIf(!disposable)('explicit v2 warehouse cost cutover is default OFF',()=>{
  let db:pg.Client;
  const branch=randomUUID(),warehouse=randomUUID(),raw=randomUUID(),legacyRaw=randomUUID();
  async function issue(material:string,ref:string){
    return (await db.query<{v:{success:boolean,error?:string,avg_cost?:number,oversold?:number}}>(
      "SELECT public._raw_remove_fifo($1,$2,$3,1,'kitchen_send','kitchen_send',$4,'SMALL-QA',NULL,true) v",
      [material,branch,warehouse,ref])).rows[0].v;
  }
  beforeAll(async()=>{
    db=openDb(url);await db.connect();await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Approved routing QA')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Approved routing WH',$2,true,true)",[warehouse,branch]);
    for(const material of [raw,legacyRaw]){
      await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'V2 routing small raw',$3,0,true)",[material,'R-'+material,branch]);
    }
    await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
    await db.query('SELECT public.seed_account_mappings($1)',[branch]);
    await db.query(innerCandidate('scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql'));
    await db.query(readFileSync('scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql','utf8'));
    await db.query(innerCandidate('scripts/db/candidates/approved_raw_cost_v2_coordinate_gate_20261031.sql'));
    const count=(await db.query<{n:number}>(
      'SELECT count(*)::int n FROM private.raw_cost_v2_activated_coordinates'
    )).rows[0].n;
    expect(count).toBe(0);
  },60000);
  afterAll(async()=>{
    if(db){try{await db.query('ROLLBACK');}finally{await db.end();}}
  });
  it('preserves legacy unactivated FIFO shortage behavior exactly',async()=>{
    const res=await issue(legacyRaw,randomUUID());
    expect(res.success).toBe(true);
    const rows=(await db.query<{n:number}>(
      'SELECT count(*)::int n FROM public.raw_fifo_debts WHERE raw_material_id=$1',[legacyRaw]
    )).rows[0].n;
    expect(rows).toBe(1);
  });
  it('routes only the explicitly activated coordinate through frozen approved price',async()=>{
    await db.query(
      "INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,1200,'pricing',$3,clock_timestamp()-interval '1 second')",
      [raw,branch,'GATE-PRICE-'+raw]);
    await db.query(
      "INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,warehouse_id,raw_material_id,activation_note) VALUES($1,$2,$3,'small CI fixture only')",
      [branch,warehouse,raw]);
    const res=await issue(raw,randomUUID());
    expect(res).toMatchObject({success:true,avg_cost:1200,oversold:1});
    const debt=(await db.query<{n:number}>(
      'SELECT count(*)::int n FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw]
    )).rows[0].n;
    expect(debt).toBe(0);
    const b=(await db.query<{n:number,qty:string}>(
      "SELECT count(*)::int n,sum(quantity)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1 AND source_type='approved_shortage_aggregate'",
      [raw])).rows[0];
    expect(b.n).toBe(1);expect(Number(b.qty)).toBe(-1);

    const rejected=(await db.query<{v:{success:boolean,error:string}}>(
      "SELECT public._raw_add($1,$2,$3,1,1400,'LOT-REQUIRES-TRACKING',NULL,NULL,'purchase','purchase_receipt',$4,'REJECTED-LOT',NULL) v",
      [raw,branch,warehouse,randomUUID()])).rows[0].v;
    expect(rejected).toMatchObject({success:false,error:'V2_RECEIPT_LOT_METADATA_NOT_SUPPORTED'});
    const before=(await db.query<{qty:string}>(
      'SELECT sum(quantity)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1',[raw])).rows[0].qty;
    expect(Number(before)).toBe(-1);

    const added=(await db.query<{v:{success:boolean,approved_shortage_absorbed:number,approved_price_variance_posted:number}}>(
      "SELECT public._raw_add($1,$2,$3,1,1400,NULL,NULL,NULL,'purchase','purchase_receipt',$4,'QA-RECEIPT',NULL) v",
      [raw,branch,warehouse,randomUUID()])).rows[0].v;
    expect(added.success).toBe(true);
    expect(Number(added.approved_shortage_absorbed)).toBe(1);
    expect(Number(added.approved_price_variance_posted)).toBe(200);
    const after=(await db.query<{qty:string}>(
      'SELECT sum(quantity)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1',[raw])).rows[0].qty;
    expect(Number(after)).toBe(0);
    const journal=(await db.query<{debits:string,credits:string,n:number}>(
      `SELECT sum(l.debit)::text debits,sum(l.credit)::text credits,
        count(DISTINCT j.id)::int n
       FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
       WHERE j.branch_id=$1 AND j.reference_type='approved_raw_shortage_variance'`,[branch])).rows[0];
    expect(journal.n).toBe(1);
    expect(Number(journal.debits)).toBeCloseTo(200,2);
    expect(Number(journal.credits)).toBeCloseTo(200,2);
  });
  it('does not expose direct activation control to authenticated users',async()=>{
    const r=(await db.query<{anon:boolean,authenticated:boolean,service:boolean}>(
      "SELECT has_table_privilege('anon','private.raw_cost_v2_activated_coordinates','INSERT') anon,has_table_privilege('authenticated','private.raw_cost_v2_activated_coordinates','INSERT') authenticated,has_table_privilege('service_role','private.raw_cost_v2_activated_coordinates','INSERT') service")).rows[0];
    expect(r).toEqual({anon:false,authenticated:false,service:false});
  });
});
