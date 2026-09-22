import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('FIFO missing historical kitchen-event fallback', () => {
  let client: pg.Client;

  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();
  const sale = randomUUID();
  const missingEvent = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'FIFO Missing Kitchen Branch')", [branch]);
    await client.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'FIFO Missing Kitchen WH',$2,true,true)",
      [warehouse, branch],
    );
    await client.query(
      "INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'FIFO Missing Kitchen Unit','u',true)",
      [unit, 'FMK-' + randomUUID().slice(0, 8)],
    );
    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES($1,$2,'FIFO Missing Kitchen Raw',$3,$4,0,true)",
      [raw, 'FMKR-' + randomUUID().slice(0, 6), branch, unit],
    );
    await client.query(
      "INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type,created_at) VALUES($1,'FIFO-MISSING-KITCHEN-SALE',$2,$3,100,100,100,'cash','completed','takeaway','2026-09-13T12:00:00Z')",
      [sale, branch, warehouse],
    );

    await client.query(
      "SELECT public._post_journal_entry($1,'sale',$2,'FIFO-MISSING-KITCHEN-SALE','Base sale COGS',jsonb_build_array(jsonb_build_object('account_key','cogs','debit',5,'credit',0),jsonb_build_object('account_key','inventory_fg','debit',0,'credit',5)))",
      [branch, sale],
    );

    await client.query(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_at) VALUES($1,$2,$3,'OLD-KITCHEN',-1,0,0,1,0,'kitchen_send','kitchen_send',$4,'FIFO-MISSING-KITCHEN-SALE','2026-09-13T11:59:00Z')",
      [raw, branch, warehouse, missingEvent],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('routes a missing kitchen event to one unique completed matching sale and reverses cleanly', async () => {
    const adjusted = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_reference_delta('kitchen_send',$1,$2,$3,'raw_material',$4,7,0) r",
      [missingEvent, branch, warehouse, raw],
    );

    expect(adjusted[0].r.success).toBe(true);
    expect(adjusted[0].r.historical_sale_fallback).toBe(true);
    expect(adjusted[0].r.ledger_authoritative).toBe(true);
    expect(String(adjusted[0].r.sale_id)).toBe(sale);

    const adj = await q<{ exact_delta: string; posted_delta: string }>(
      'SELECT exact_delta::text,posted_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adj[0].exact_delta)).toBe(7);
    expect(num(adj[0].posted_delta)).toBe(7);

    const margin = await q<{ cogs: string }>(
      'SELECT cogs::text FROM public.get_order_margin($1,NULL,NULL) WHERE sale_id=$2',
      [branch, sale],
    );
    expect(num(margin[0].cogs)).toBe(12);

    const reversed = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_reference_delta('kitchen_send',$1,$2,$3,'raw_material',$4,-7,0) r",
      [missingEvent, branch, warehouse, raw],
    );
    expect(reversed[0].r.success).toBe(true);
    expect(reversed[0].r.historical_sale_fallback).toBe(true);

    const remaining = await q<{ count: string }>(
      'SELECT count(*)::text count FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(remaining[0].count)).toBe(0);

    const restored = await q<{ cogs: string }>(
      'SELECT cogs::text FROM public.get_order_margin($1,NULL,NULL) WHERE sale_id=$2',
      [branch, sale],
    );
    expect(num(restored[0].cogs)).toBe(5);
  });
});
