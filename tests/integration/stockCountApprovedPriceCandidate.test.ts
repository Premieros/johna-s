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
    // Reconstruct the inspected production function bindings in this local-only
    // transaction. CI separately applies the migration in canonical sequence.
    const baseline=readFileSync('scripts/candidates/historical_raw_counts_binding_rollback_20261104.sql','utf8')
      .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await db.query(baseline);
    // Install the exact release migration inside the rollback-only fixture.
    const release=readFileSync('supabase/migrations/20261104062413_historical_raw_counts_latest_price.sql','utf8')
      .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
    await db.query(release);
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
      "SELECT unit_cost,price_source FROM private.stock_count_raw_price($1,ARRAY[$2]::uuid[],now()) WHERE raw_material_id=$2",
      [branch,raw],
    );
    expect(Number(now.rows[0].unit_cost)).toBe(0);
    expect(now.rows[0].price_source).toBe('catalog_zero');
    const before = await db.query(
      "SELECT unit_cost,price_source FROM private.stock_count_raw_price($1,ARRAY[$2]::uuid[],now()-interval '30 years') WHERE raw_material_id=$2",
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
      expect(blocked.success).toBe(false);
      expect(blocked.detail).toContain('COUNT_LEGACY_QUANTITY_UNRECONCILED');
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
      const run=randomUUID();
      await db.query("INSERT INTO public.raw_fifo_price_fallback_runs(id,branch_id,status) VALUES($1,$2,'applied')",[run,branch]);
      await db.query("INSERT INTO public.raw_fifo_debt_price_estimates(debt_id,source_ledger_id,run_id,branch_id,raw_material_id,estimated_unit_cost,original_estimated_quantity,remaining_estimated_quantity,candidate_source,candidate_event_id,candidate_at) SELECT id,source_ledger_id,$2,branch_id,raw_material_id,10,19,19,'pricing','QA-ESTIMATE','2026-10-31' FROM public.raw_fifo_debts WHERE source_ledger_id=$1",[sale,run]);
      const futureSale=(await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,-8,10,-80,'sale','sale',$4,'2026-11-02') RETURNING id",[material,branch,warehouse,randomUUID()])).rows[0].id;
      await db.query("INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,debt_quantity,source_created_at) VALUES($1,$2,$3,$4,$5,8,'2026-11-02')",[futureSale,material,branch,warehouse,laterBatch]);
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
      const estimate=(await db.query('SELECT remaining_estimated_quantity,zero_cost_finalized_quantity FROM public.raw_fifo_debt_price_estimates WHERE source_ledger_id=$1',[sale])).rows[0];
      expect(Number(estimate.remaining_estimated_quantity)).toBe(19-Math.min(19,receiptQty));
      expect(Number(estimate.zero_cost_finalized_quantity)).toBe(Math.min(19,receiptQty));
      const balance=(await db.query("SELECT sum(quantity) qty FROM public.raw_material_batches WHERE raw_material_id=$1",[material])).rows[0];
      expect(Number(balance.qty)).toBe(-27+receiptQty);
      expect(Number((await db.query("SELECT total_cost FROM public.inventory_ledger WHERE id=$1",[sale])).rows[0].total_cost)).toBe(-190);
      expect(Number((await db.query("SELECT quantity FROM public.raw_material_batches WHERE id=$1",[laterBatch])).rows[0].quantity)).toBe(-8);
      expect(Number((await db.query('SELECT settled_quantity FROM public.raw_fifo_debts WHERE source_ledger_id=$1',[futureSale])).rows[0].settled_quantity)).toBe(0);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT quantity_offset');
      await db.query('RELEASE SAVEPOINT quantity_offset');
    }
  });

  it('applies a historical negative-stock count atomically at the latest price with a balanced journal', async () => {
    await db.query('RESET ROLE');
    await db.query('SAVEPOINT integrated_count');
    try {
      const material=randomUUID(), negative=randomUUID(), laterBatch=randomUUID(), doc=randomUUID();
      await db.query("INSERT INTO public.raw_materials(id,branch_id,code,name,default_cost) VALUES($1::uuid,$2,$1::uuid::text,'Integrated count fixture',0)",[material,branch]);
      await db.query("INSERT INTO public.raw_material_batches(id,raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$3,$4,$5,'NEG-INTEGRATED',-19,10,'kitchen_send_oversold'),($2,$3,$4,$5,'LATER-INTEGRATED',-8,10,'kitchen_send_oversold')",[negative,laterBatch,material,branch,warehouse]);
      for (const [qty,batch,time] of [[19,negative,'2026-10-31'],[8,laterBatch,'2026-11-02']] as const) {
        const sale=(await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,-$4::numeric,10,-$4::numeric*10,'sale','sale',$5,$6) RETURNING id",[material,branch,warehouse,qty,randomUUID(),time])).rows[0].id;
        await db.query("INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,debt_quantity,source_created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[sale,material,branch,warehouse,batch,qty,time]);
      }
      await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at,created_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now(),'2026-11-01 07:00Z')",[doc,branch,warehouse,actor,'QA-INTEGRATED-'+doc.slice(0,8)]);
      await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,-24,4,0)",[doc,material]);
      // A price published AFTER the count must be used, independently of quantity date.
      await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,10,'pricing',$3,'2026-11-03')",[material,branch,'QA-LATEST-'+doc]);
      await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
      await db.query('SELECT public.seed_account_mappings($1)',[branch]);
      // A live stock writer owns the same lock on a separate connection.
      // Count must return promptly without changing stock or blocking the sale.
      const writer=openDb(url);
      await writer.connect();
      try {
        await writer.query('BEGIN');
        await writer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[material+':'+branch]);
        await db.query('SET LOCAL ROLE authenticated');
        const busy=(await db.query('SELECT public.apply_stock_count($1) r',[doc])).rows[0].r;
        await db.query('RESET ROLE');
        expect(busy.success).toBe(false);
        expect(busy.detail).toContain('STOCK_COUNT_STOCK_BUSY_RETRY');
      } finally {
        await writer.query('ROLLBACK');
        await writer.end();
      }
      // A missing accounting mapping must undo the receipt, offsets and count status.
      await db.query('SAVEPOINT bad_mapping');
      await db.query("UPDATE public.account_mappings SET semantic_key='qa_missing_variance' WHERE branch_id=$1 AND semantic_key='stock_variance'",[branch]);
      await db.query('SET LOCAL ROLE authenticated');
      const rejected=(await db.query('SELECT public.apply_stock_count($1) r',[doc])).rows[0].r;
      await db.query('RESET ROLE');
      expect(rejected.success).toBe(false);
      expect(Number((await db.query("SELECT count(*) n FROM public.inventory_ledger WHERE reference_id=$1",[doc])).rows[0].n)).toBe(0);
      expect(Number((await db.query('SELECT sum(settled_quantity) qty FROM public.raw_fifo_debts WHERE raw_material_id=$1',[material])).rows[0].qty)).toBe(0);
      await db.query('ROLLBACK TO SAVEPOINT bad_mapping');
      await db.query('RELEASE SAVEPOINT bad_mapping');
      await db.query('SET LOCAL ROLE authenticated');
      const applied=(await db.query('SELECT public.apply_stock_count($1) r',[doc])).rows[0].r;
      expect(applied.success,JSON.stringify(applied)).toBe(true);
      const retry=(await db.query('SELECT public.apply_stock_count($1) r',[doc])).rows[0].r;
      expect(retry.success).toBe(false);
      await db.query('RESET ROLE');
      expect(Number((await db.query('SELECT sum(quantity) qty FROM public.raw_material_batches WHERE raw_material_id=$1',[material])).rows[0].qty)).toBe(-4);
      const countLedger=(await db.query("SELECT sum(quantity) qty,sum(total_cost) value,min(created_at)::text at FROM public.inventory_ledger WHERE reference_id=$1",[doc])).rows[0];
      expect(Number(countLedger.qty)).toBe(23);
      expect(Number(countLedger.value)).toBe(230);
      const line=(await db.query('SELECT system_quantity,variance_quantity,variance_value FROM public.stock_count_items WHERE stock_count_id=$1',[doc])).rows[0];
      expect(Number(line.system_quantity)).toBe(-19);
      expect(Number(line.variance_quantity)).toBe(23);
      expect(Number(line.variance_value)).toBe(230);
      expect(new Date(countLedger.at).toISOString()).toBe('2026-11-01T07:00:00.000Z');
      expect(Number((await db.query("SELECT sum(total_cost) value FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_type='sale'",[material])).rows[0].value)).toBe(-270);
      expect(Number((await db.query('SELECT quantity FROM public.raw_material_batches WHERE id=$1',[laterBatch])).rows[0].quantity)).toBe(-8);
      const journal=(await db.query('SELECT sum(debit) debit,sum(credit) credit FROM public.journal_entry_lines WHERE journal_entry_id=$1',[applied.journal_entry_id])).rows[0];
      expect(Number(journal.debit)).toBe(230);
      expect(Number(journal.credit)).toBe(230);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT integrated_count');
      await db.query('RELEASE SAVEPOINT integrated_count');
      await db.query('RESET ROLE');
    }
  });

  it('keeps a count shortage valued at its published price when a later receipt settles quantity', async () => {
    await db.query('RESET ROLE');
    await db.query('SAVEPOINT shortage_count');
    try {
      const material=randomUUID(), negative=randomUUID(), doc=randomUUID();
      await db.query("INSERT INTO public.raw_materials(id,branch_id,code,name,default_cost) VALUES($1::uuid,$2,$1::uuid::text,'Count shortage fixture',0)",[material,branch]);
      await db.query("INSERT INTO public.raw_material_batches(id,raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$2,$3,$4,'LATER-SHORT',-3,10,'kitchen_send_oversold')",[negative,material,branch,warehouse]);
      await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,created_at) VALUES($1,$2,$3,5,10,50,'purchase','qa_seed','2026-10-31')",[material,branch,warehouse]);
      const sale=(await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,-8,10,-80,'sale','sale',$4,'2026-11-02') RETURNING id",[material,branch,warehouse,randomUUID()])).rows[0].id;
      await db.query("INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,debt_quantity,source_created_at) VALUES($1,$2,$3,$4,$5,3,'2026-11-02')",[sale,material,branch,warehouse,negative]);
      await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at,created_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now(),'2026-11-01 07:00Z')",[doc,branch,warehouse,actor,'QA-SHORT-'+doc.slice(0,8)]);
      await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,5,2,0)",[doc,material]);
      await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,10,'pricing',$3,'2026-11-03')",[material,branch,'QA-SHORT-PRICE-'+doc]);
      await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
      await db.query('SELECT public.seed_account_mappings($1)',[branch]);
      await db.query('SET LOCAL ROLE authenticated');
      const applied=(await db.query('SELECT public.apply_stock_count($1) r',[doc])).rows[0].r;
      expect(applied.success,JSON.stringify(applied)).toBe(true);
      await db.query('RESET ROLE');
      expect(Number((await db.query('SELECT sum(quantity) qty FROM public.raw_material_batches WHERE raw_material_id=$1',[material])).rows[0].qty)).toBe(-6);
      // Reverting the application binding after posting must not remove the
      // receipt freeze protecting the count's approved value.
      const rollback=readFileSync('scripts/candidates/historical_raw_counts_binding_rollback_20261104.sql','utf8')
        .replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
      await db.query(rollback);
      const received=(await db.query("SELECT public._raw_add($1,$2,$3,6,30,NULL,NULL,NULL,'purchase','qa_receipt',$4,NULL,NULL) r",[material,branch,warehouse,randomUUID()])).rows[0].r;
      expect(received.success,JSON.stringify(received)).toBe(true);
      const ledger=(await db.query('SELECT quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE reference_id=$1',[doc])).rows;
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].quantity)).toBe(-3);
      expect(Number(ledger[0].unit_cost)).toBe(10);
      expect(Number(ledger[0].total_cost)).toBe(-30);
      expect(Number((await db.query('SELECT sum(quantity) qty FROM public.raw_material_batches WHERE raw_material_id=$1',[material])).rows[0].qty)).toBe(0);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT shortage_count');
      await db.query('RELEASE SAVEPOINT shortage_count');
      await db.query('RESET ROLE');
    }
  });

});

