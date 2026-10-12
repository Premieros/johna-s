import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Opt-in ONLY for disposable local Postgres. Never runs against Supabase.
const dbUrl = process.env.RAW_FIFO_REVIEW_LOCAL_DB_URL || process.env.SUPABASE_DB_URL || '';
let local = false;
try {
  const u = new URL(dbUrl);
  local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    && ['postgres:', 'postgresql:'].includes(u.protocol)
    && !dbUrl.includes('supabase.co') && !dbUrl.includes('azzdesuowpdcoflmyezn');
} catch { /* skip when not explicitly configured */ }

// PostgreSQL EXPLAIN FORMAT JSON puts execution time on the statement
// envelope, while buffer/WAL counters belong to the nested Plan root.
type Plan = {
  'Execution Time'?: number;
  Plan?: {
    'Shared Hit Blocks'?: number;
    'Shared Read Blocks'?: number;
    'Shared Written Blocks'?: number;
    'Shared Dirtied Blocks'?: number;
    'WAL Records'?: number;
    'WAL Bytes'?: number;
    'WAL FPI'?: number;
  };
};
const n = (v: unknown) => Number(v || 0);
const stageA = 'scripts/experiments/raw_fifo_receipt_settle_candidate_20261012.sql';
const stageB = 'scripts/experiments/raw_stock_official_balance_delta_candidate_20261012.sql';

describe.skipIf(!local)('Johnas FIFO lower-total-load review, local disposable DB only', () => {
  let db: pg.Client;
  const branch = randomUUID();
  const wh1 = randomUUID();
  const wh2 = randomUUID();
  const raw = randomUUID();
  const countRaw = randomUUID();
  const sale = randomUUID();
  const countSale = randomUUID();
  const user = randomUUID();
  const role = 'qa_fifo_' + randomUUID().slice(0, 8);

  const query = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> =>
    (await db.query(sql, values)).rows as T[];

  const measured = async (sql: string, values: unknown[]): Promise<Plan> => {
    const rows = await query<{ 'QUERY PLAN': Plan[] }>(
      'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ' + sql, values);
    return rows[0]['QUERY PLAN'][0];
  };

  const tally = (p: Plan) => ({
    ms: p['Execution Time'] ?? null,
    sharedHits: p.Plan?.['Shared Hit Blocks'] ?? null,
    sharedReads: p.Plan?.['Shared Read Blocks'] ?? null,
    sharedWrites: p.Plan?.['Shared Written Blocks'] ?? null,
    sharedDirtied: p.Plan?.['Shared Dirtied Blocks'] ?? null,
    walRecords: p.Plan?.['WAL Records'] ?? null,
    walBytes: p.Plan?.['WAL Bytes'] ?? null,
    walFpi: p.Plan?.['WAL FPI'] ?? null,
  });

  const total = (plans: Plan[]) => {
    const rows = plans.map(tally);
    return {
      ms: Number(rows.reduce((sum, row) => sum + (row.ms ?? 0), 0).toFixed(3)),
      sharedHits: rows.reduce((sum, row) => sum + (row.sharedHits ?? 0), 0),
      sharedReads: rows.reduce((sum, row) => sum + (row.sharedReads ?? 0), 0),
      sharedWrites: rows.reduce((sum, row) => sum + (row.sharedWrites ?? 0), 0),
      sharedDirtied: rows.reduce((sum, row) => sum + (row.sharedDirtied ?? 0), 0),
      walRecords: rows.reduce((sum, row) => sum + (row.walRecords ?? 0), 0),
      walBytes: rows.reduce((sum, row) => sum + (row.walBytes ?? 0), 0),
      walFpi: rows.reduce((sum, row) => sum + (row.walFpi ?? 0), 0),
    };
  };

  const qty = async (rawId: string, warehouse?: string) => {
    const sql = warehouse
      ? 'SELECT COALESCE(SUM(quantity),0)::text AS q FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3'
      : 'SELECT quantity::text AS q FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2';
    const got = await query<{ q: string }>(sql, warehouse ? [rawId, branch, warehouse] : [rawId, branch]);
    return n(got[0]?.q);
  };

  const oversell = async (rawId: string, amount: number, saleId: string, number: string) => {
    const rows = await query<{ result: { success: boolean; oversold: number } }>(
      "SELECT public._raw_remove_fifo($1,$2,$3,$4,'sale','sale',$5,$6,NULL,true) AS result",
      [rawId, branch, wh1, amount, saleId, number]);
    expect(rows[0].result.success).toBe(true);
    return rows[0].result;
  };

  async function runPurchaseAfterDebt() {
    // EXPLAIN ANALYZE executes the real negative-consumption helper used by
    // sale/kitchen callers; this is NOT a timed send_to_kitchen RPC.
    const deductions: Plan[] = [];
    for (let i = 0; i < 12; i++) {
      deductions.push(await measured(
        "SELECT public._raw_remove_fifo($1,$2,$3,$4,'sale','sale',$5,$6,NULL,true)",
        [raw, branch, wh1, 0.5, sale, 'REVIEW-DEBT-' + i],
      ));
    }
    expect(await qty(raw, wh1)).toBe(-6);
    expect(await qty(raw)).toBe(-6);
    const otherReceipt = await measured(
      "SELECT public._raw_add($1,$2,$3,4,11,NULL,NULL,NULL,'purchase_receipt','fifo_review',$4,'REVIEW-WH2',NULL)",
      [raw, branch, wh2, randomUUID()],
    );
    expect(await qty(raw, wh2)).toBe(4);
    const receipt = await measured(
      "SELECT public._raw_add($1,$2,$3,8,7,NULL,NULL,NULL,'purchase_receipt','fifo_review',$4,'REVIEW-RECEIPT',NULL)",
      [raw, branch, wh1, randomUUID()],
    );
    const debts = await query<{ amount: string; settled: string }>(
      'SELECT SUM(debt_quantity)::text amount,SUM(settled_quantity)::text settled FROM public.raw_fifo_debts WHERE raw_material_id=$1',
      [raw]);
    const amounts = await query<{ cost: string; journal: string; average: string }>(
      "SELECT COALESCE((SELECT SUM(total_cost) FROM public.inventory_ledger WHERE raw_material_id=$1 AND entry_type='sale'),0)::text AS cost, " +
      "COALESCE((SELECT SUM(exact_delta) FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$2),0)::text AS journal, " +
      "(SELECT avg_cost::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$3) AS average",
      [raw, sale, branch]);
    const result = {
      branch: await qty(raw),
      warehouse1: await qty(raw, wh1),
      warehouse2: await qty(raw, wh2),
      debtQuantity: n(debts[0].amount),
      debtSettled: n(debts[0].settled),
      saleCost: n(amounts[0].cost),
      journalDelta: n(amounts[0].journal),
      positiveAvgCost: n(amounts[0].average),
    };
    expect(result).toEqual({
      branch: 6, warehouse1: 2, warehouse2: 4,
      debtQuantity: 6, debtSettled: 6,
      saleCost: -42, journalDelta: 42, positiveAvgCost: 9.67,
    });
    return { result, receipt: tally(receipt), negative: total(deductions),
      otherReceipt: tally(otherReceipt), allInventoryStatements: total([...deductions, otherReceipt, receipt]) };
  }

  const asUser = async <T>(f: () => Promise<T>) => {
    await db.query("SELECT set_config('app.user_id',$1,true)", [user]);
    await db.query('SET LOCAL ROLE authenticated');
    try { return await f(); }
    finally {
      await db.query('RESET ROLE').catch(() => {});
      await db.query('RESET app.user_id').catch(() => {});
    }
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: dbUrl });
    await db.connect();
    await db.query('BEGIN');
    // Production has two FIFO estimated-cost tables absent from canonical CI.
    // Install their read-only-captured shape transactionally, LOCAL ONLY.
    await db.query(readFileSync(
      'scripts/experiments/raw_fifo_price_estimate_parity_local_20261012.sql',
      'utf8',
    ));
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'FIFO stage benchmark')", [branch]);
    await db.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Review WH1',$3,true,true),($2,'Review WH2',$3,true,false)",
      [wh1, wh2, branch]);
    await db.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES ($1,$3,'Review Purchase Raw',$5,0,true),($2,$4,'Review Count Raw',$5,9,true)",
      [raw, countRaw, 'FREV-' + randomUUID(), 'FCNT-' + randomUUID(), branch]);
    await db.query(
      "INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) " +
      "VALUES($1::uuid,'REV-A-'||($1::uuid)::text,$3,$4,100,100,100,'cash','completed','takeaway'),($2::uuid,'REV-B-'||($2::uuid)::text,$3,$4,100,100,100,'cash','completed','takeaway')",
      [sale, countSale, branch, wh1]);
    await db.query(
      "INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES($1,'جرد','Count Reviewer','[\"inventory.count.create\",\"inventory.count.approve\",\"inventory.count.apply\"]'::jsonb,'global',true)",
      [role]);
    await db.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await db.query(
      "INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'FIFO Reviewer',$3,$4,true)",
      [user, randomUUID() + '@test.local', role, branch]);
    await db.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  }, 30000);

  afterAll(async () => {
    if (db) {
      await db.query('ROLLBACK').catch(() => {});
      await db.end().catch(() => {});
    }
  });

  it('replays identical negative-first multiwarehouse debt settlement before/after and measures buffers, WAL and time', async () => {
    // Both baseline and candidate must use the *same production function*
    // rather than comparing the historical CI migration to the newer live
    // function (which includes estimated-cost settlement logic).
    const candidateSql = readFileSync(stageA, 'utf8');
    const functionStart = candidateSql.indexOf('CREATE OR REPLACE FUNCTION public._raw_fifo_settle_receipt(');
    expect(functionStart).toBeGreaterThan(0);
    const afterFunction = candidateSql.slice(functionStart);
    const deferred = '    -- Receipt batch update is deferred until after every source reconciliation.';
    expect(afterFunction).toContain(deferred);
    let baselineFunction = afterFunction.replace(deferred, `    UPDATE public.raw_material_batches
    SET quantity=GREATEST(quantity-v_take,0)
    WHERE id=v_batch.id;`);
    const finalStart = baselineFunction.indexOf('  -- All debt, estimate, COGS/journal');
    const finalReturn = baselineFunction.indexOf('  RETURN jsonb_build_object(', finalStart);
    expect(finalStart).toBeGreaterThan(0);
    expect(finalReturn).toBeGreaterThan(finalStart);
    baselineFunction = baselineFunction.slice(0, finalStart) + baselineFunction.slice(finalReturn);
    expect(baselineFunction).not.toContain('quantity-v_total_settled');
    await db.query(baselineFunction);

    // Factorial A/B: isolate extra index maintenance from helper function
    // changes. Savepoints rewind both fixture writes and transactional DDL.
    await db.query('SAVEPOINT stock_before');
    const baselineNoIndex = await runPurchaseAfterDebt();
    await db.query('ROLLBACK TO SAVEPOINT stock_before');

    await db.query(afterFunction); // Stage A settlement, WITHOUT a new index.
    await db.query(readFileSync(stageB, 'utf8'));
    const optimizedNoIndex = await runPurchaseAfterDebt();
    expect(optimizedNoIndex.result).toEqual(baselineNoIndex.result);
    await db.query('ROLLBACK TO SAVEPOINT stock_before');

    // Same FIFO index for BOTH executions in this pair.
    await db.query(candidateSql.slice(0, functionStart));
    await db.query('SAVEPOINT stock_index_before');
    const baselineWithIndex = await runPurchaseAfterDebt();
    await db.query('ROLLBACK TO SAVEPOINT stock_index_before');

    await db.query(afterFunction);
    await db.query(readFileSync(stageB, 'utf8'));
    const optimizedWithIndex = await runPurchaseAfterDebt();
    expect(optimizedWithIndex.result).toEqual(baselineWithIndex.result);
    expect(baselineWithIndex.result).toEqual(baselineNoIndex.result);

    console.info('RAW_FIFO_TOTAL_LOAD_FACTORIAL_LOCAL', JSON.stringify({
      debts: 12,
      scope: '12 negative inventory deductions + 2 receipts, NOT complete sale/kitchen/purchase RPC',
      baselineNoIndex, optimizedNoIndex, baselineWithIndex, optimizedWithIndex,
      caution: 'Single rollback-only local samples; order/cache noise, not production-concurrency/p95 or index-write proof',
    }));
  }, 120000);

  it('applies an authorized physical count after negative kitchen consumption with exact debt/COGS and retry protection', async () => {
    await oversell(countRaw, 5, countSale, 'REVIEW-COUNT-SALE');
    expect(await qty(countRaw)).toBe(-5);
    const created = await asUser(async () => query<{ result: { success: boolean; stock_count_id: string } }>(
      "SELECT public.create_stock_count($1,$2,'cycle','fifo negative test',$3::jsonb) AS result",
      [branch, wh1, JSON.stringify([{ raw_material_id: countRaw, counted_quantity: 3, unit_cost: 9, reason: 'physical count' }])]));
    expect(created[0].result.success).toBe(true);
    const countId = created[0].result.stock_count_id;
    await db.query("UPDATE public.stock_counts SET status='approved' WHERE id=$1", [countId]);
    const applied = await asUser(async () => query<{ result: { success: boolean; items_applied: number } }>(
      'SELECT public.apply_stock_count($1) AS result', [countId]));
    expect(applied[0].result).toMatchObject({ success: true, items_applied: 1 });
    expect(await qty(countRaw)).toBe(3);
    expect(await qty(countRaw, wh1)).toBe(3);
    const debts = await query<{ settled: string }>(
      'SELECT SUM(settled_quantity)::text settled FROM public.raw_fifo_debts WHERE raw_material_id=$1',
      [countRaw]);
    expect(n(debts[0].settled)).toBe(5);
    const retry = await asUser(async () => query<{ result: { success: boolean; error: string } }>(
      'SELECT public.apply_stock_count($1) AS result', [countId]));
    expect(retry[0].result).toMatchObject({ success: false, error: 'COUNT_NOT_APPROVED' });
    expect(await qty(countRaw)).toBe(3);
  }, 45000);

  it('retains a single official branch summary, the original cost trigger and the partial FIFO order index', async () => {
    const rows = await query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='raw_material_batches' AND indexname='idx_raw_batches_fifo_positive_order_review'");
    expect(rows).toHaveLength(1);
    const avgTrigger = await query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname='trg_raw_inventory_actual_avg_cost_guard'");
    expect(avgTrigger[0].tgenabled).toBe('O');
    const shadow = await query<{ regclass_name: string | null }>(
      "SELECT to_regclass('private.raw_stock_warehouse_shadow')::text AS regclass_name");
    expect(shadow[0].regclass_name).toBeNull();
  });
});
