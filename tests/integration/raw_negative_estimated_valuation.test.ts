import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown) => Number(v || 0);

describe.skipIf(skip)('Raw negative estimated valuation', () => {
  let client: pg.Client;
  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.branches(id,name) VALUES($1,'Negative valuation branch')`, [branch]);
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'Negative valuation WH',$2,true)`,
      [warehouse, branch],
    );
    await client.query(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'Kilogram','kg',true)`,
      [unit, `KG-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
       VALUES($1,$2,'Estimated Negative Raw',$3,$4,0,true)`,
      [raw, `RAW-${randomUUID().slice(0, 8)}`, branch, unit],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('prices oversold batch from last real FIFO cost without posting estimated COGS', async () => {
    await client.query(
      `SELECT public._raw_add($1,$2,$3,5,1200,NULL,NULL,NULL,'purchase_receipt','purchase_receipt',$4,'TEST-PURCHASE',NULL)`,
      [raw, branch, warehouse, randomUUID()],
    );

    await client.query(
      `SELECT public._raw_remove_fifo($1,$2,$3,7,'sale','sale',$4,'TEST-SALE',NULL,true)`,
      [raw, branch, warehouse, randomUUID()],
    );

    const batch = await client.query(
      `SELECT quantity,unit_cost
       FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND source_type='sale_oversold'
       ORDER BY created_at DESC,id DESC LIMIT 1`,
      [raw],
    );
    expect(num(batch.rows[0].quantity)).toBe(-2);
    expect(num(batch.rows[0].unit_cost)).toBe(1200);

    const ledger = await client.query(
      `SELECT quantity,unit_cost,total_cost
       FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND batch_number LIKE 'OV-%'
       ORDER BY id DESC LIMIT 1`,
      [raw],
    );
    expect(num(ledger.rows[0].quantity)).toBe(-2);
    expect(num(ledger.rows[0].unit_cost)).toBe(0);
    expect(num(ledger.rows[0].total_cost)).toBe(0);

    const inv = await client.query(
      `SELECT quantity,avg_cost FROM public.raw_material_inventory
       WHERE raw_material_id=$1 AND branch_id=$2`,
      [raw, branch],
    );
    expect(num(inv.rows[0].quantity)).toBe(-2);
    expect(num(inv.rows[0].avg_cost)).toBe(0);
  });

  it('settles the estimate with the real purchase and keeps actual average based on positive stock only', async () => {
    await client.query(
      `SELECT public._raw_add($1,$2,$3,3,1300,NULL,NULL,NULL,'purchase_receipt','purchase_receipt',$4,'TEST-REAL-PURCHASE',NULL)`,
      [raw, branch, warehouse, randomUUID()],
    );

    const inv = await client.query(
      `SELECT quantity,avg_cost FROM public.raw_material_inventory
       WHERE raw_material_id=$1 AND branch_id=$2`,
      [raw, branch],
    );
    expect(num(inv.rows[0].quantity)).toBe(1);
    expect(num(inv.rows[0].avg_cost)).toBe(1300);

    const ledger = await client.query(
      `SELECT unit_cost,total_cost
       FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND batch_number LIKE 'OV-%'
       ORDER BY id DESC LIMIT 1`,
      [raw],
    );
    expect(num(ledger.rows[0].unit_cost)).toBe(1300);
    expect(num(ledger.rows[0].total_cost)).toBe(-2600);
  });
});
