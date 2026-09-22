import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('Opening inventory FIFO cost repair', () => {
  let client: pg.Client;

  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();
  const sale = randomUUID();
  const openingBatch = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'Opening FIFO Repair Branch')", [branch]);
    await client.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Opening FIFO WH',$2,true,true)",
      [warehouse, branch],
    );
    await client.query(
      "INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'Opening FIFO Unit','u',true)",
      [unit, 'OFR-' + randomUUID().slice(0, 8)],
    );
    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES($1,$2,'Opening Zero Cost Raw',$3,$4,0,true)",
      [raw, 'ORAW-' + randomUUID().slice(0, 6), branch, unit],
    );
    await client.query(
      "INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type,created_at) VALUES($1,'OPEN-FIFO-SALE',$2,$3,100,100,100,'cash','completed','takeaway','2026-09-02T12:00:00Z')",
      [sale, branch, warehouse],
    );

    await client.query(
      "SELECT public._post_journal_entry($1,'sale',$2,'OPEN-FIFO-SALE','Opening repair base COGS',jsonb_build_array(jsonb_build_object('account_key','cogs','debit',1,'credit',0),jsonb_build_object('account_key','inventory_fg','debit',0,'credit',1)))",
      [branch, sale],
    );

    await client.query(
      "INSERT INTO public.raw_material_batches(id,raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES($1,$2,$3,$4,'OPEN-REPAIR',3,0,'opening_inventory','2026-09-01T00:00:00Z')",
      [openingBatch, raw, branch, warehouse],
    );

    await client.query(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_at) VALUES($1,$2,$3,'OPEN-REPAIR',5,0,0,0,5,'adjustment','opening_inventory',NULL,'OPEN-REPAIR','2026-09-01T00:00:00Z'),($1,$2,$3,'OPEN-REPAIR',-2,0,0,5,3,'sale','sale',$4,'OPEN-FIFO-SALE','2026-09-02T12:00:00Z')",
      [raw, branch, warehouse, sale],
    );

    await client.query(
      "INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,3,0)",
      [raw, branch],
    );

    // Opening-time authoritative evidence is required for automatic repair.
    await client.query(
      "INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,detail,priced_at) VALUES($1,$2,10,'pricing','PRICE-OPEN-REPAIR','integration candidate','2026-09-01T00:00:00Z')",
      [raw, branch],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('prepares, applies and reverses opening valuation without changing stock quantity', async () => {
    const prepared = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_opening_cost_prepare_repair($1) r',
      [branch],
    );

    expect(num(prepared[0].r.opening_batches)).toBe(1);
    expect(num(prepared[0].r.eligible_batches)).toBe(1);
    expect(num(prepared[0].r.unresolved_batches)).toBe(0);

    const runId = String(prepared[0].r.run_id);

    const plan = await q<{
      candidate_cost: string;
      candidate_source: string;
      candidate_basis: string;
      opening_quantity: string;
    }>(
      'SELECT candidate_cost::text,candidate_source,candidate_basis,opening_quantity::text FROM public.raw_opening_cost_repair_plan WHERE run_id=$1',
      [runId],
    );
    expect(num(plan[0].candidate_cost)).toBe(10);
    expect(plan[0].candidate_source).toBe('pricing');
    expect(plan[0].candidate_basis).toBe('latest_at_or_before_opening');
    expect(num(plan[0].opening_quantity)).toBe(5);

    const beforeQty = await q<{ qty: string }>(
      'SELECT quantity::text qty FROM public.raw_material_batches WHERE id=$1',
      [openingBatch],
    );
    expect(num(beforeQty[0].qty)).toBe(3);

    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_opening_cost_apply_repair($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(true);
    expect(num(applied[0].r.applied_batches)).toBe(1);

    const batch = await q<{ quantity: string; unit_cost: string }>(
      'SELECT quantity::text,unit_cost::text FROM public.raw_material_batches WHERE id=$1',
      [openingBatch],
    );
    expect(num(batch[0].quantity)).toBe(3);
    expect(num(batch[0].unit_cost)).toBe(10);

    const opening = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_type='opening_inventory'",
      [raw],
    );
    expect(num(opening[0].unit_cost)).toBe(10);
    expect(num(opening[0].total_cost)).toBe(50);

    const consumed = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_type='sale' AND reference_id=$2",
      [raw, sale],
    );
    expect(num(consumed[0].unit_cost)).toBe(10);
    expect(num(consumed[0].total_cost)).toBe(-20);

    const adjustment = await q<{ exact_delta: string }>(
      'SELECT exact_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adjustment[0].exact_delta)).toBe(20);

    const afterQty = await q<{ qty: string }>(
      'SELECT quantity::text qty FROM public.raw_material_batches WHERE id=$1',
      [openingBatch],
    );
    expect(num(afterQty[0].qty)).toBe(3);

    const reversed = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_opening_cost_reverse_repair($1) r',
      [runId],
    );
    expect(reversed[0].r.success).toBe(true);

    const restoredBatch = await q<{ quantity: string; unit_cost: string }>(
      'SELECT quantity::text,unit_cost::text FROM public.raw_material_batches WHERE id=$1',
      [openingBatch],
    );
    expect(num(restoredBatch[0].quantity)).toBe(3);
    expect(num(restoredBatch[0].unit_cost)).toBe(0);

    const restoredOpening = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_type='opening_inventory'",
      [raw],
    );
    expect(num(restoredOpening[0].unit_cost)).toBe(0);
    expect(num(restoredOpening[0].total_cost)).toBe(0);

    const restoredConsumed = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_type='sale' AND reference_id=$2",
      [raw, sale],
    );
    expect(num(restoredConsumed[0].unit_cost)).toBe(0);
    expect(num(restoredConsumed[0].total_cost)).toBe(0);

    const reverseAgain = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_opening_cost_reverse_repair($1) r',
      [runId],
    );
    expect(reverseAgain[0].r.success).toBe(true);
    expect(reverseAgain[0].r.already_reversed).toBe(true);
  });
});
