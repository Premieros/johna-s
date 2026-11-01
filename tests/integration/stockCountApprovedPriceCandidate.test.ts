import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// Never execute the NOT-FOR-PRODUCTION function against a shared database.
// Local CI fixtures are transaction-scoped and rolled back unconditionally.
const url = getDbUrl();
let local = false;
try { local = ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname); } catch { /* no DB */ }

describe.skipIf(!local)('latest-price stock count candidate in disposable database', () => {
  let db: pg.Client;
  const branch=randomUUID(), warehouse=randomUUID(), actor=randomUUID();
  const raw=randomUUID(), shortRaw=randomUUID(), count=randomUUID(), zeroCount=randomUUID(), zeroIssueCount=randomUUID(), latestPriceCount=randomUUID();
  beforeAll(async () => {
    db=openDb(url); await db.connect(); await db.query('BEGIN');
    // Install the existing unshipped v2 movement prototype ONLY inside this local
    // disposable transaction. Strip outer transaction commands to retain ROLLBACK.
    const schema=readFileSync('scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql','utf8')
      .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await db.query(schema);
    const helpers=readFileSync('scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql','utf8');
    await db.query(helpers);
    const candidate=readFileSync('scripts/candidates/stock_count_apply_last_price_ATOMIC_NOT_FOR_PRODUCTION_20261101.sql','utf8');
    await db.query(candidate);
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Latest price QA')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,branch_id,name,is_active) VALUES($1,$2,'Latest price QA WH',true)",[warehouse,branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Zero cost raw',$3,0,true)",[raw,'QA-'+raw.slice(0,8),branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'FIFO cost test raw',$3,0,true)",[shortRaw,'QA-'+shortRaw.slice(0,8),branch]);
    const initial=(await db.query("SELECT public._raw_add($1,$2,$3,5,12,NULL,NULL,NULL,'adjustment','qa_seed',NULL,NULL,NULL) r",[shortRaw,branch,warehouse])).rows[0].r;
    if (!initial?.success) throw new Error('QA_INITIAL_RAW_ADD_FAILED '+JSON.stringify(initial));
    await db.query("SELECT set_config('app.register_branch','on',true)");
    await db.query("INSERT INTO public.users(id,email,role,branch_id,is_active) VALUES($1,$2,'warehouse_manager',$3,true)",[actor,actor+'@latest-price.test',branch]);
    await db.query("SELECT set_config('app.register_branch','off',true)");
    await db.query("UPDATE public.roles SET permissions=(COALESCE(permissions,'[]'::jsonb)||'[\"inventory.count.apply\"]'::jsonb) WHERE role='warehouse_manager'");
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[count,branch,warehouse,actor,'QA-ZERO-'+count.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,0,3,0),($1,$3,5,2,0)",[count,raw,shortRaw]);
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)",[actor]);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);
    await db.query('SET LOCAL ROLE authenticated');
  },45000);
  afterAll(async () => { if(db){ await db.query('ROLLBACK').catch(()=>{}); await db.end(); } });
  it('rejects unpriced materials atomically without altering inventory or accounts', async () => {
    const before=(await db.query("SELECT quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND warehouse_id=$2",[shortRaw,warehouse])).rows[0];
    const {rows}=await db.query('SELECT public.apply_stock_count($1) result',[count]);
    expect(rows[0].result.success).toBe(false);
    expect(rows[0].result.detail).toContain('APPROVED_RAW_PRICE_UNAVAILABLE');
    await db.query('RESET ROLE');
    expect((await db.query('SELECT status FROM public.stock_counts WHERE id=$1',[count])).rows[0].status).toBe('approved');
    const after=(await db.query("SELECT quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND warehouse_id=$2",[shortRaw,warehouse])).rows[0];
    expect(Number(after.quantity)).toBe(Number(before.quantity));
    const ledger=(await db.query("SELECT count(*)::int n FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count'",[count])).rows[0];
    expect(ledger.n).toBe(0);
    const frozen=(await db.query('SELECT unit_cost FROM public.stock_count_items WHERE stock_count_id=$1',[count])).rows;
    expect(frozen.every(x=>Number(x.unit_cost)===0)).toBe(true);
  });
  it('reads explicit catalog zero at count time but not before catalog update', async () => {
    // The canonical reader candidate is never installed in production here.
    // This transaction is deliberately rolled back by afterAll.
    const pricing = readFileSync('scripts/candidates/latest_approved_price_zero_catalog_NOT_FOR_PRODUCTION_20261101.sql','utf8')
      .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await db.query(pricing);
    const now = await db.query(
      "SELECT unit_cost,price_source FROM private.latest_approved_raw_prices($1,ARRAY[$2]::uuid[],now()) WHERE raw_material_id=$2",
      [branch,raw],
    );
    expect(Number(now.rows[0].unit_cost)).toBe(0);
    expect(now.rows[0].price_source).toBe('catalog_zero');
    const before = await db.query(
      "SELECT unit_cost,price_source FROM private.latest_approved_raw_prices($1,ARRAY[$2]::uuid[],now()-interval '30 years') WHERE raw_material_id=$2",
      [branch,raw],
    );
    expect(before.rows[0].unit_cost).toBeNull();
    expect(before.rows[0].price_source).toBe('unpriced');
  });

  it('posts a zero-priced raw surplus with zero-valued ledger and no invented journal', async () => {
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[zeroCount,branch,warehouse,actor,'QA-ZERO-POST-'+zeroCount.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,0,3,0)",[zeroCount,raw]);
    await db.query("SET LOCAL ROLE authenticated");
    const result=(await db.query('SELECT public.apply_stock_count($1) AS r',[zeroCount])).rows[0].r;
    expect(result.success).toBe(true);
    await db.query('RESET ROLE');
    const ledger=(await db.query("SELECT quantity,total_cost,unit_cost FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count' AND raw_material_id=$2",[zeroCount,raw])).rows;
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.reduce((sum,r)=>sum+Number(r.quantity),0)).toBe(3);
    expect(ledger.every(r=>Number(r.total_cost)===0 && Number(r.unit_cost)===0)).toBe(true);
    expect((await db.query("SELECT status FROM public.stock_counts WHERE id=$1",[zeroCount])).rows[0].status).toBe('applied');
  });

  it('issues zero-priced raw shortage at zero ledger value without FIFO valuation', async () => {
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[zeroIssueCount,branch,warehouse,actor,'QA-ZERO-ISSUE-'+zeroIssueCount.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,3,1,0)",[zeroIssueCount,raw]);
    await db.query('SET LOCAL ROLE authenticated');
    const result=(await db.query('SELECT public.apply_stock_count($1) AS r',[zeroIssueCount])).rows[0].r;
    await db.query('RESET ROLE');
    expect(result.success).toBe(true);
    const ledger=(await db.query("SELECT quantity,total_cost,unit_cost FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count' AND raw_material_id=$2",[zeroIssueCount,raw])).rows;
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every(r=>Number(r.total_cost)===0 && Number(r.unit_cost)===0)).toBe(true);
    const inventory=(await db.query("SELECT quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND warehouse_id=$2",[raw,warehouse])).rows[0];
    expect(Number(inventory.quantity)).toBe(1);
    expect((await db.query("SELECT status FROM public.stock_counts WHERE id=$1",[zeroIssueCount])).rows[0].status).toBe('applied');
  });

  it('values a raw shortage at the latest approved price, not the historic FIFO batch cost', async () => {
    // shortRaw was seeded into a legacy batch at cost 12; the canonical
    // approved pricing event is 7. Every count movement must use 7.
    await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,7,'pricing',$3,now()-interval '1 minute')",[shortRaw,branch,'QA-APPROVED-PRICE']);
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[latestPriceCount,branch,warehouse,actor,'QA-LAST-PRICE-'+latestPriceCount.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,5,2,0)",[latestPriceCount,shortRaw]);
    await db.query('SET LOCAL ROLE authenticated');
    const outcome=(await db.query('SELECT public.apply_stock_count($1) r',[latestPriceCount])).rows[0].r;
    await db.query('RESET ROLE');
    expect(outcome.success).toBe(true);
    const entries=(await db.query("SELECT quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count' AND raw_material_id=$2",[latestPriceCount,shortRaw])).rows;
    expect(entries.reduce((total,e)=>total+Number(e.quantity),0)).toBe(-3);
    expect(entries.every(e=>Number(e.unit_cost)===7)).toBe(true);
    expect(entries.reduce((total,e)=>total+Number(e.total_cost),0)).toBe(-21);
    const balance=(await db.query("SELECT quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND warehouse_id=$2",[shortRaw,warehouse])).rows[0];
    expect(Number(balance.quantity)).toBe(2);
  });

});
