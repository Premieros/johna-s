import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('raw FIFO prior-price fallback', () => {
  let client: pg.Client;

  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();
  const rawNoPrice = randomUUID();
  const sale = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await q(`INSERT INTO public.branches(id,name) VALUES($1,'FIFO Price Fallback Branch')`, [branch]);
    await q(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default)
       VALUES($1,'FIFO Price Fallback WH',$2,true,true)`,
      [warehouse, branch],
    );
    await q(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active)
       VALUES($1,$2,'Fallback Unit','u',true)`,
      [unit, 'FF-' + randomUUID().slice(0, 8)],
    );
    await q(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
       VALUES
         ($1,$3,'Fallback Raw',$4,$5,0,true),
         ($2,$6,'Fallback No Price Raw',$4,$5,0,true)`,
      [
        raw,
        rawNoPrice,
        'FRAW-' + randomUUID().slice(0, 6),
        branch,
        unit,
        'FNOP-' + randomUUID().slice(0, 6),
      ],
    );
    await q(
      `INSERT INTO public.sales(
         id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type
       ) VALUES($1,'FF-SALE',$2,$3,100,100,100,'cash','completed','takeaway')`,
      [sale, branch, warehouse],
    );

    await q('SELECT public.ensure_chart_of_accounts($1)', [branch]);
    await q('SELECT public.seed_account_mappings($1)', [branch]);

    // Authoritative historical price exists before the zero-cost consumption.
    await q(
      `INSERT INTO public.raw_material_price_events(
         id,raw_material_id,branch_id,unit_cost,source,reference_number,detail,priced_at
       ) VALUES($1,$2,$3,10,'pricing','FF-PRICE','fixture',now()-interval '2 days')`,
      [randomUUID(), raw, branch],
    );

    // Create zero-cost oversold debt after the price event.
    await q(
      `SELECT public._raw_remove_fifo(
         $1,$2,$3,5,'sale','sale',$4,'FF-SALE',NULL,true
       )`,
      [raw, branch, warehouse, sale],
    );

    // A second zero-cost debt intentionally has no authoritative prior price.
    await q(
      `SELECT public._raw_remove_fifo(
         $1,$2,$3,1,'sale','sale',$4,'FF-SALE',NULL,true
       )`,
      [rawNoPrice, branch, warehouse, sale],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('applies prior price without changing physical quantity', async () => {
    const before = await q<{ qty: string }>(
      `SELECT COALESCE(sum(quantity),0)::text qty
       FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [raw, branch, warehouse],
    );

    const prep = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_price_fallback_prepare($1) r',
      [branch],
    );
    expect(prep[0].r.success).toBe(true);
    expect(num(prep[0].r.zero_cost_rows)).toBe(2);
    expect(num(prep[0].r.eligible_rows)).toBe(1);
    expect(num(prep[0].r.unresolved_rows)).toBe(1);
    expect(num(prep[0].r.target_cost_value)).toBe(50);

    const unresolved = await q<{ eligible: boolean; unresolved_reason: string }>(
      `SELECT eligible,unresolved_reason
       FROM public.raw_fifo_price_fallback_plan
       WHERE run_id=$1 AND raw_material_id=$2`,
      [String(prep[0].r.run_id), rawNoPrice],
    );
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].eligible).toBe(false);
    expect(unresolved[0].unresolved_reason).toBe('NO_PRIOR_AUTHORITATIVE_PRICE');

    const runId = String(prep[0].r.run_id);
    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_price_fallback_apply($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(true);
    expect(num(applied[0].r.applied_rows)).toBe(1);
    expect(num(applied[0].r.applied_value)).toBe(50);

    const after = await q<{ qty: string }>(
      `SELECT COALESCE(sum(quantity),0)::text qty
       FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [raw, branch, warehouse],
    );
    expect(num(after[0].qty)).toBe(num(before[0].qty));

    const source = await q<{ total_cost: string; unit_cost: string }>(
      `SELECT total_cost::text,unit_cost::text
       FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND reference_type='sale' AND reference_id=$2 AND quantity<0
       ORDER BY id DESC LIMIT 1`,
      [raw, sale],
    );
    expect(num(source[0].total_cost)).toBe(-50);
    expect(num(source[0].unit_cost)).toBe(10);

    const estimate = await q<{ estimated_unit_cost: string; remaining_estimated_quantity: string }>(
      `SELECT estimated_unit_cost::text,remaining_estimated_quantity::text
       FROM public.raw_fifo_debt_price_estimates
       WHERE source_ledger_id=(
         SELECT id FROM public.inventory_ledger
         WHERE raw_material_id=$1 AND reference_id=$2 AND quantity<0
         ORDER BY id DESC LIMIT 1
       )`,
      [raw, sale],
    );
    expect(num(estimate[0].estimated_unit_cost)).toBe(10);
    expect(num(estimate[0].remaining_estimated_quantity)).toBe(5);
  });

  it('posts only actual-minus-estimate when a positive-cost receipt settles debt', async () => {
    const ref = randomUUID();
    const receipt = await q<{ r: Record<string, unknown> }>(
      `SELECT public._raw_add(
         $1,$2,$3,2,15,NULL,NULL,NULL,
         'purchase_receipt','fifo_test_receipt',$4,'FF-RCPT-15',NULL
       ) r`,
      [raw, branch, warehouse, ref],
    );
    expect(num(receipt[0].r.fifo_settled_quantity)).toBe(2);
    expect(num(receipt[0].r.fifo_settled_value)).toBe(30);

    const source = await q<{ total_cost: string }>(
      `SELECT total_cost::text
       FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND reference_id=$2 AND quantity<0
       ORDER BY id DESC LIMIT 1`,
      [raw, sale],
    );
    // 5x10 fallback + 2x(15-10) replacement = 60 total COGS.
    expect(num(source[0].total_cost)).toBe(-60);

    const adj = await q<{ exact_delta: string }>(
      'SELECT exact_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adj[0].exact_delta)).toBe(60);

    const estimate = await q<{ remaining: string; replaced: string }>(
      `SELECT remaining_estimated_quantity::text remaining,replaced_quantity::text replaced
       FROM public.raw_fifo_debt_price_estimates`,
    );
    expect(num(estimate[0].remaining)).toBe(3);
    expect(num(estimate[0].replaced)).toBe(2);
  });

  it('keeps fallback cost when a zero-cost receipt settles part of remaining debt', async () => {
    const ref = randomUUID();
    const receipt = await q<{ r: Record<string, unknown> }>(
      `SELECT public._raw_add(
         $1,$2,$3,1,0,NULL,NULL,NULL,
         'purchase_receipt','fifo_test_receipt',$4,'FF-RCPT-0',NULL
       ) r`,
      [raw, branch, warehouse, ref],
    );
    expect(num(receipt[0].r.fifo_settled_quantity)).toBe(1);
    expect(num(receipt[0].r.cost_adjustment)).toBe(0);

    const source = await q<{ total_cost: string }>(
      `SELECT total_cost::text
       FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND reference_id=$2 AND quantity<0
       ORDER BY id DESC LIMIT 1`,
      [raw, sale],
    );
    expect(num(source[0].total_cost)).toBe(-60);

    const estimate = await q<{ remaining: string; zero_finalized: string }>(
      `SELECT remaining_estimated_quantity::text remaining,
              zero_cost_finalized_quantity::text zero_finalized
       FROM public.raw_fifo_debt_price_estimates`,
    );
    expect(num(estimate[0].remaining)).toBe(2);
    expect(num(estimate[0].zero_finalized)).toBe(1);
  });

  it('refuses reversal once a later receipt has consumed provisional estimate state', async () => {
    const run = await q<{ id: string }>(
      `SELECT id::text FROM public.raw_fifo_price_fallback_runs
       WHERE branch_id=$1 AND status='applied'
       ORDER BY created_at DESC LIMIT 1`,
      [branch],
    );
    const reversed = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_price_fallback_reverse($1) r',
      [run[0].id],
    );
    expect(reversed[0].r.success).toBe(false);
    expect(reversed[0].r.error).toBe('FIFO_PRICE_FALLBACK_ESTIMATE_CONSUMED');
  });
});
