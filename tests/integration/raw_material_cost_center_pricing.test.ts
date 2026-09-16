import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('raw material cost-center pricing', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const rawId = randomUUID();
  const purchaseId = randomUUID();
  const stockCountId = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.organizations (id, name, slug)
       VALUES ($1, 'Raw Cost Test Org', $2)`,
      [orgId, `raw-cost-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches (id, name, organization_id)
       VALUES ($1, 'Raw Cost Test Branch', $2)`,
      [branchId, orgId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES ($1, 'Raw Cost Test Warehouse', $2, true)`,
      [warehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_materials (id, code, name, branch_id, default_cost)
       VALUES ($1, $2, 'Raw Cost Test Material', $3, 0)`,
      [rawId, `RC-${randomUUID().slice(0, 8)}`, branchId],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('uses a completed purchase price when live valuation is missing', async () => {
    await client.query(
      `INSERT INTO public.purchases
         (id, invoice_number, branch_id, warehouse_id, status, approved_at)
       VALUES ($1, $2, $3, $4, 'completed', now() - interval '2 minutes')`,
      [purchaseId, `INV-${randomUUID().slice(0, 8)}`, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.purchase_items
         (purchase_id, raw_material_id, quantity, unit_cost, total, created_at)
       VALUES ($1, $2, 10, 17.50, 175, now() - interval '2 minutes')`,
      [purchaseId, rawId],
    );

    const result = await client.query<{ cost: string }>(
      `SELECT public._raw_wavg_cost($1, $2) AS cost`,
      [rawId, branchId],
    );
    expect(Number(result.rows[0].cost)).toBe(17.5);
  });

  it('uses a newer applied stock-count price when live valuation is missing', async () => {
    await client.query(
      `INSERT INTO public.stock_counts
         (id, branch_id, warehouse_id, status, count_type, count_number, applied_at)
       VALUES ($1, $2, $3, 'applied', 'cycle', $4, now())`,
      [stockCountId, branchId, warehouseId, `SC-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.stock_count_items
         (stock_count_id, raw_material_id, system_quantity, counted_quantity, unit_cost)
       VALUES ($1, $2, 0, 10, 22.75)`,
      [stockCountId, rawId],
    );

    const result = await client.query<{ cost: string }>(
      `SELECT public._raw_wavg_cost($1, $2) AS cost`,
      [rawId, branchId],
    );
    expect(Number(result.rows[0].cost)).toBe(22.75);
  });

  it('keeps current positive batch weighted average as the primary source', async () => {
    await client.query(
      `INSERT INTO public.raw_material_batches
         (raw_material_id, branch_id, warehouse_id, batch_number, quantity, unit_cost)
       VALUES ($1, $2, $3, $4, 4, 30)`,
      [rawId, branchId, warehouseId, `B-${randomUUID().slice(0, 8)}`],
    );

    const result = await client.query<{ cost: string }>(
      `SELECT public._raw_wavg_cost($1, $2) AS cost`,
      [rawId, branchId],
    );
    expect(Number(result.rows[0].cost)).toBe(30);
  });

  it('uses persisted inventory average before historical prices when batches are absent', async () => {
    await client.query(
      `DELETE FROM public.raw_material_batches
       WHERE raw_material_id = $1 AND branch_id = $2`,
      [rawId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_inventory
         (raw_material_id, branch_id, quantity, avg_cost)
       VALUES ($1, $2, 10, 26.40)`,
      [rawId, branchId],
    );

    const result = await client.query<{ cost: string }>(
      `SELECT public._raw_wavg_cost($1, $2) AS cost`,
      [rawId, branchId],
    );
    expect(Number(result.rows[0].cost)).toBe(26.4);
  });
});
