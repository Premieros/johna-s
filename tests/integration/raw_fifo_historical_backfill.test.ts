import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('Historical raw FIFO backfill', () => {
  let client: pg.Client;

  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();
  const rawStale = randomUUID();
  const sale = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'FIFO Historical Branch')", [branch]);
    await client.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'FIFO Historical WH',$2,true,true)",
      [warehouse, branch],
    );
    await client.query(
      "INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'FIFO Historical Unit','u',true)",
      [unit, 'FHB-' + randomUUID().slice(0, 8)],
    );
    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES ($1,$3,'Historical Raw',$2,$5,0,true),($4,$6,'Historical Raw Stale',$2,$5,0,true)",
      [raw, branch, 'HRAW-' + randomUUID().slice(0, 6), rawStale, unit, 'HSTALE-' + randomUUID().slice(0, 6)],
    );
    await client.query(
      "INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type,created_at) VALUES($1,'FIFO-HIST-SALE',$2,$3,100,100,100,'cash','completed','takeaway','2026-01-02T12:00:00Z')",
      [sale, branch, warehouse],
    );

    await client.query(
      "SELECT public._post_journal_entry($1,'sale',$2,'FIFO-HIST-SALE','Historical base sale COGS',jsonb_build_array(jsonb_build_object('account_key','cogs','debit',8,'credit',0),jsonb_build_object('account_key','inventory_fg','debit',0,'credit',8)))",
      [branch, sale],
    );

    await client.query(
      "INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES ($1,$2,$3,'H-B1',0,4,'purchase','2026-01-01T08:00:00Z'),($1,$2,$3,'OV-HIST',-3,0,'sale_oversold','2026-01-02T12:00:00Z'),($1,$2,$3,'H-B2',3,10,'purchase','2026-01-03T08:00:00Z')",
      [raw, branch, warehouse],
    );

    await client.query(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_at) VALUES ($1,$2,$3,'H-B1',2,4,8,0,2,'purchase','purchase',NULL,'H-P1','2026-01-01T08:00:00Z'),($1,$2,$3,'H-B1',-2,4,-8,2,0,'sale','sale',$4,'FIFO-HIST-SALE','2026-01-02T12:00:00Z'),($1,$2,$3,'OV-HIST',-3,0,0,0,-3,'sale','sale',$4,'FIFO-HIST-SALE','2026-01-02T12:00:01Z'),($1,$2,$3,'H-B2',3,10,30,-3,0,'purchase','purchase',NULL,'H-P2','2026-01-03T08:00:00Z')",
      [raw, branch, warehouse, sale],
    );
    await client.query(
      "INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,0,0)",
      [raw, branch],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('prepares and applies historical FIFO without changing net stock or double-applying cost', async () => {
    const prepared = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_prepare_backfill($1) r',
      [branch],
    );
    const runId = String(prepared[0].r.run_id);
    expect(num(prepared[0].r.changed_rows)).toBe(1);
    expect(num(prepared[0].r.net_cost_delta)).toBe(30);
    expect(num(prepared[0].r.unresolved_quantity)).toBe(0);

    const before = await q<{ qty: string }>(
      'SELECT COALESCE(sum(quantity),0)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
      [raw, branch, warehouse],
    );
    expect(num(before[0].qty)).toBe(0);

    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(true);

    const after = await q<{ qty: string }>(
      'SELECT COALESCE(sum(quantity),0)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
      [raw, branch, warehouse],
    );
    expect(num(after[0].qty)).toBe(0);

    const debt = await q<{ debt_quantity: string; settled_quantity: string }>(
      'SELECT debt_quantity::text,settled_quantity::text FROM public.raw_fifo_debts WHERE raw_material_id=$1 AND reference_id=$2',
      [raw, sale],
    );
    expect(num(debt[0].debt_quantity)).toBe(3);
    expect(num(debt[0].settled_quantity)).toBe(3);

    const oversoldLedger = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND batch_number='OV-HIST'",
      [raw],
    );
    expect(num(oversoldLedger[0].unit_cost)).toBe(10);
    expect(num(oversoldLedger[0].total_cost)).toBe(-30);

    const adj = await q<{ exact_delta: string; posted_delta: string }>(
      'SELECT exact_delta::text,posted_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adj[0].exact_delta)).toBe(30);
    expect(num(adj[0].posted_delta)).toBe(30);

    const margin = await q<{ cogs: string }>(
      'SELECT cogs::text FROM public.get_order_margin($1,NULL,NULL) WHERE sale_id=$2',
      [branch, sale],
    );
    expect(num(margin[0].cogs)).toBe(38);

    const again = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(again[0].r.success).toBe(true);
    expect(again[0].r.already_applied).toBe(true);

    const adjAgain = await q<{ exact_delta: string }>(
      'SELECT exact_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adjAgain[0].exact_delta)).toBe(30);
  });

  it('rejects a prepared plan after a new raw ledger movement makes it stale', async () => {
    const prepared = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_prepare_backfill($1) r',
      [branch],
    );
    const runId = String(prepared[0].r.run_id);

    const ref = randomUUID();
    const added = await q<{ r: Record<string, unknown> }>(
      "SELECT public._raw_add($1,$2,$3,1,2,NULL,NULL,NULL,'purchase','purchase',$4,'FIFO-STALE',NULL) r",
      [rawStale, branch, warehouse, ref],
    );
    expect(added[0].r.success).toBe(true);

    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(false);
    expect(applied[0].r.error).toBe('FIFO_BACKFILL_STALE_PLAN');
  });
});
