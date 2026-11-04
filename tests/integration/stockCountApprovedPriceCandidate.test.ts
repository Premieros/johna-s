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
  const raw=randomUUID(), shortRaw=randomUUID(), unpricedRaw=randomUUID(), count=randomUUID(), zeroCount=randomUUID(), zeroIssueCount=randomUUID(), latestPriceCount=randomUUID();
  // Both priced and default-zero materials must share the atomic posting path.
  const firstLine='00000000-0000-4000-8000-000000000011';
  const failingLine='00000000-0000-4000-8000-000000000012';
  beforeAll(async () => {
    db=openDb(url); await db.connect(); await db.query('BEGIN');
    // Install the existing unshipped v2 movement prototype ONLY inside this local
    // disposable transaction. Strip outer transaction commands to retain ROLLBACK.
    const schema=readFileSync('scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql','utf8')
      .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await db.query(schema);
    const helpers=readFileSync('scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql','utf8');
    await db.query(helpers);
    // Install the candidate price reader first, so every count movement shares it.
    const pricing=readFileSync('scripts/candidates/latest_approved_price_zero_catalog_NOT_FOR_PRODUCTION_20261101.sql','utf8')
      .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await db.query(pricing);
    const candidate=readFileSync('scripts/candidates/stock_count_apply_last_price_ATOMIC_NOT_FOR_PRODUCTION_20261101.sql','utf8');
    await db.query(candidate);
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Latest price QA')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,branch_id,name,is_active) VALUES($1,$2,'Latest price QA WH',true)",[warehouse,branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Zero cost raw',$3,0,true)",[raw,'QA-'+raw.slice(0,8),branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'FIFO cost test raw',$3,0,true)",[shortRaw,'QA-'+shortRaw.slice(0,8),branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Unpriced raw',$3,0,true)",[unpricedRaw,'QA-'+unpricedRaw.slice(0,8),branch]);
    // Updating catalog metadata must not suppress the default zero price.
    await db.query("UPDATE public.raw_materials SET updated_at=now()+interval '1 day' WHERE id=$1",[unpricedRaw]);
    const initial=(await db.query("SELECT public._raw_add($1,$2,$3,5,12,NULL,NULL,NULL,'adjustment','qa_seed',NULL,NULL,NULL) r",[shortRaw,branch,warehouse])).rows[0].r;
    if (!initial?.success) throw new Error('QA_INITIAL_RAW_ADD_FAILED '+JSON.stringify(initial));
    await db.query("SELECT set_config('app.register_branch','on',true)");
    await db.query("INSERT INTO public.users(id,email,role,branch_id,is_active) VALUES($1,$2,'warehouse_manager',$3,true)",[actor,actor+'@latest-price.test',branch]);
    await db.query("SELECT set_config('app.register_branch','off',true)");
    await db.query("UPDATE public.roles SET permissions=(COALESCE(permissions,'[]'::jsonb)||'[\"inventory.count.apply\"]'::jsonb) WHERE role='warehouse_manager'");
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[count,branch,warehouse,actor,'QA-ZERO-'+count.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(id,stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($4,$1,$2,0,3,0),($5,$1,$3,0,2,0)",[count,raw,unpricedRaw,firstLine,failingLine]);
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)",[actor]);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);
    await db.query('SET LOCAL ROLE authenticated');
  },45000);
  afterAll(async () => { if(db){ await db.query('ROLLBACK').catch(()=>{}); await db.end(); } });
  it('posts quantities for unpriced materials without adding financial value', async () => {
    await db.query('SAVEPOINT unpriced_count_test');
    try {
      await db.query('SET LOCAL ROLE authenticated');
      const {rows}=await db.query('SELECT public.apply_stock_count($1) result',[count]);
      expect(rows[0].result.success,JSON.stringify(rows[0].result)).toBe(true);
      await db.query('RESET ROLE');
      const ledger=(await db.query("SELECT raw_material_id, sum(quantity) qty, sum(abs(total_cost)) cost FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count' GROUP BY raw_material_id",[count])).rows;
      expect(ledger).toHaveLength(2);
      expect(Number(ledger.find(r=>r.raw_material_id===raw)?.qty)).toBe(3);
      expect(Number(ledger.find(r=>r.raw_material_id===unpricedRaw)?.qty)).toBe(2);
      expect(ledger.every(r=>Number(r.cost)===0)).toBe(true);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT unpriced_count_test');
      await db.query('RELEASE SAVEPOINT unpriced_count_test');
      await db.query('RESET ROLE');
    }
  });
  it('uses the default zero independently of catalog update time', async () => {
    // The canonical reader candidate is never installed in production here.
    // This transaction is deliberately rolled back by afterAll.
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
    expect(Number(before.rows[0].unit_cost)).toBe(0);
    expect(before.rows[0].price_source).toBe('catalog_zero');
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

  it('preserves later sales and values only the historical count delta', async () => {
    await db.query('RESET ROLE');
    // shortRaw was seeded into a legacy batch at cost 12; the canonical
    // approved pricing event is 7. Every count movement must use 7.
    await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,7,'pricing',$3,now()-interval '1 minute')",[shortRaw,branch,'QA-APPROVED-PRICE']);
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[latestPriceCount,branch,warehouse,actor,'QA-LAST-PRICE-'+latestPriceCount.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,5,2,0)",[latestPriceCount,shortRaw]);
    await db.query("UPDATE public.stock_counts SET created_at=clock_timestamp() WHERE id=$1",[latestPriceCount]);
    const laterSale=randomUUID();
    const sale=(await db.query("SELECT private.raw_issue_approved_v2($1,$2,$3,1,'sale','qa_sale',$4) r",[shortRaw,branch,warehouse,laterSale])).rows[0].r;
    expect(sale.success).toBe(true);
    await db.query('SAVEPOINT open_legacy_debt');
    try {
      await db.query("INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,debt_quantity,source_created_at) SELECT id,raw_material_id,branch_id,warehouse_id,1,created_at FROM public.inventory_ledger WHERE reference_id=$1 LIMIT 1",[laterSale]);
      await db.query('SET LOCAL ROLE authenticated');
      const blocked=(await db.query('SELECT public.apply_stock_count($1) r',[latestPriceCount])).rows[0].r;
      await db.query('RESET ROLE');
      expect(blocked).toMatchObject({success:false,error:'LEGACY_FIFO_POSITION_NOT_CUTOVER'});
      expect((await db.query("SELECT count(*)::int n FROM public.inventory_ledger WHERE reference_id=$1",[latestPriceCount])).rows[0].n).toBe(0);
      expect((await db.query("SELECT status FROM public.stock_counts WHERE id=$1",[latestPriceCount])).rows[0].status).toBe('approved');
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT open_legacy_debt');
      await db.query('RELEASE SAVEPOINT open_legacy_debt');
    }

    await db.query('SET LOCAL ROLE authenticated');
    const outcome=(await db.query('SELECT public.apply_stock_count($1) r',[latestPriceCount])).rows[0].r;
    const retry=(await db.query('SELECT public.apply_stock_count($1) r',[latestPriceCount])).rows[0].r;
    await db.query('RESET ROLE');
    expect(retry.success).toBe(false);
    const later=(await db.query("SELECT quantity FROM public.inventory_ledger WHERE reference_id=$1",[laterSale])).rows;
    expect(later.reduce((sum,row)=>sum+Number(row.quantity),0)).toBe(-1);
    expect(outcome.success).toBe(true);
    const entries=(await db.query("SELECT quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count' AND raw_material_id=$2",[latestPriceCount,shortRaw])).rows;
    expect(entries.reduce((total,e)=>total+Number(e.quantity),0)).toBe(-3);
    expect(entries.every(e=>Number(e.unit_cost)===7)).toBe(true);
    expect(entries.reduce((total,e)=>total+Number(e.total_cost),0)).toBe(-21);
    const balance=(await db.query("SELECT quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND warehouse_id=$2",[shortRaw,warehouse])).rows[0];
    expect(Number(balance.quantity)).toBe(1);
  });

  it.each([23,10])('offsets pre-count negative quantity for receipt %s without repricing or repetition', async (receiptQty) => {
    await db.query('RESET ROLE');
    await db.query('SAVEPOINT quantity_offset');
    try {
      await db.query(readFileSync('scripts/db/candidates/stock_count_offset_legacy_quantity_NOT_FOR_PRODUCTION.sql','utf8'));
      const material=randomUUID(), negative=randomUUID(), receiptBatch=randomUUID(), laterBatch=randomUUID();
      const doc=randomUUID(), time='2026-11-01T07:00:00Z';
      await db.query("INSERT INTO public.raw_materials(id,branch_id,code,name,default_cost) VALUES($1::uuid,$2,$1::uuid::text,'Offset fixture',0)",[material,branch]);
      await db.query("INSERT INTO public.raw_material_batches(id,raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$4,$5,$6,'NEG-QA',-19,10,'kitchen_send_oversold'),($2,$4,$5,$6,'REC-QA',$7,10,'stock_count'),($3,$4,$5,$6,'LATER-QA',-8,10,'kitchen_send_oversold')",[negative,receiptBatch,laterBatch,material,branch,warehouse,receiptQty]);
      const sale=(await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,-19,10,-190,'sale','sale',$4,'2026-10-31') RETURNING id",[material,branch,warehouse,randomUUID()])).rows[0].id;
      await db.query("INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,debt_quantity,source_created_at) VALUES($1,$2,$3,$4,$5,19,'2026-10-31')",[sale,material,branch,warehouse,negative]);
      const receipt=(await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,'REC-QA',$6,10,$6::numeric*10,'adjustment','stock_count',$4,$5) RETURNING id",[material,branch,warehouse,doc,time,receiptQty])).rows[0].id;
      await db.query('SAVEPOINT invalid_negative');
      await db.query('UPDATE public.raw_material_batches SET quantity=-1 WHERE id=$1',[negative]);
      await expect(db.query('SELECT private.offset_stock_count_legacy_quantity($1,$2)',[receipt,receiptBatch])).rejects.toThrow('COUNT_NEGATIVE_BATCH_UNRECONCILED');
      await db.query('ROLLBACK TO SAVEPOINT invalid_negative');
      await db.query('RELEASE SAVEPOINT invalid_negative');
      expect(Number((await db.query('SELECT count(*) n FROM public.raw_fifo_settlements WHERE receipt_ledger_id=$1',[receipt])).rows[0].n)).toBe(0);
      const applied=(await db.query('SELECT private.offset_stock_count_legacy_quantity($1,$2) qty',[receipt,receiptBatch])).rows[0];
      expect(Number(applied.qty)).toBe(Math.min(19,receiptQty));
      const retry=(await db.query('SELECT private.offset_stock_count_legacy_quantity($1,$2) qty',[receipt,receiptBatch])).rows[0];
      expect(Number(retry.qty)).toBe(0);
      const balance=(await db.query("SELECT sum(quantity) qty FROM public.raw_material_batches WHERE raw_material_id=$1",[material])).rows[0];
      expect(Number(balance.qty)).toBe(-27+receiptQty);
      expect(Number((await db.query("SELECT total_cost FROM public.inventory_ledger WHERE id=$1",[sale])).rows[0].total_cost)).toBe(-190);
      expect(Number((await db.query("SELECT quantity FROM public.raw_material_batches WHERE id=$1",[laterBatch])).rows[0].quantity)).toBe(-8);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT quantity_offset');
      await db.query('RELEASE SAVEPOINT quantity_offset');
    }
  });

});

