import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('raw pricing authoritative costing cycle', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const managerUser = randomUUID();
  const viewerUser = randomUUID();
  const rawA = randomUUID();
  const rawB = randomUUID();
  let kgUnit = '';

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function latest() {
    return asUser(managerUser, async () => {
      const r = await client.query(
        `SELECT latest_cost::text, price_source, reference_number
           FROM public.get_raw_material_cost_overview($1)
          WHERE raw_material_id = $2`,
        [branchA, rawA],
      );
      return r.rows[0] as { latest_cost: string; price_source: string; reference_number: string | null };
    });
  }

  async function valuation() {
    return asUser(managerUser, async () => {
      const r = await client.query(
        `SELECT estimated_negative_value::text, unpriced_negative_quantity::text
           FROM public.get_raw_material_cost_valuation_overview($1)
          WHERE raw_material_id = $2`,
        [branchA, rawA],
      );
      return r.rows[0] as { estimated_negative_value: string; unpriced_negative_quantity: string };
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.organizations (id, name, slug)
       VALUES ($1, 'Raw Pricing Org', $2)`,
      [orgId, `raw-price-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches (id, name, organization_id)
       VALUES ($1, 'Pricing Branch A', $3),
              ($2, 'Pricing Branch B', $3)`,
      [branchA, branchB, orgId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES ($1, 'Pricing Warehouse A', $2, true)`,
      [warehouseA, branchA],
    );

    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, is_active)
       VALUES
         ('raw_pricing_manager', 'مسعر خامات', 'Raw Pricing Manager', $1::jsonb, true),
         ('raw_pricing_viewer', 'مشاهد', 'Viewer', $2::jsonb, true)
       ON CONFLICT (role) DO UPDATE
       SET permissions = EXCLUDED.permissions, is_active = true`,
      [
        JSON.stringify(['raw_materials.view', 'raw_materials.manage', 'reports.costing']),
        JSON.stringify(['raw_materials.view', 'reports.costing']),
      ],
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES
         ($1, $2, 'Raw Pricing Manager', 'raw_pricing_manager', $3, true),
         ($4, $5, 'Raw Pricing Viewer', 'raw_pricing_viewer', $3, true)`,
      [
        managerUser,
        `${randomUUID()}@test.local`,
        branchA,
        viewerUser,
        `${randomUUID()}@test.local`,
      ],
    );

    const kg = await client.query<{ id: string }>(
      `SELECT id FROM public.measurement_units WHERE code = 'KG' LIMIT 1`,
    );
    kgUnit = kg.rows[0]?.id ?? '';
    expect(kgUnit).toBeTruthy();

    await client.query(
      `INSERT INTO public.raw_materials (id, code, name, unit_id, default_cost, is_active, branch_id)
       VALUES
         ($1, 'RAW-PRICE-A', 'Raw Price A', $3, 5, true, $4),
         ($2, 'RAW-PRICE-B', 'Raw Price B', $3, 6, true, $5)`,
      [rawA, rawB, kgUnit, branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.raw_material_inventory (raw_material_id, branch_id, quantity, avg_cost)
       VALUES ($1, $2, 12, 7)`,
      [rawA, branchA],
    );

    const oldPurchaseId = randomUUID();
    await client.query(
      `INSERT INTO public.purchases
         (id, invoice_number, branch_id, subtotal, total, paid_amount, status, created_at, approved_at)
       VALUES ($1, $2, $3, 10, 10, 10, 'completed', clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours')`,
      [oldPurchaseId, `OLD-${randomUUID().slice(0, 8)}`, branchA],
    );
    await client.query(
      `INSERT INTO public.purchase_items
         (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total, created_at)
       VALUES ($1, $2, 'kg', 1, 10, 10, clock_timestamp() - interval '2 hours')`,
      [oldPurchaseId, rawA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('records manual pricing as the latest costing event without changing inventory avg/quantity', async () => {
    const result = await asUser(managerUser, async () => {
      const r = await client.query(
        `SELECT public.set_raw_material_price($1, $2, 20, 'manual-test') AS r`,
        [rawA, branchA],
      );
      return r.rows[0].r;
    });

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.source).toBe('pricing');

    const inventory = await client.query(
      `SELECT quantity::text, avg_cost::text FROM public.raw_material_inventory
       WHERE raw_material_id = $1 AND branch_id = $2`,
      [rawA, branchA],
    );
    expect(Number(inventory.rows[0].quantity)).toBe(12);
    expect(Number(inventory.rows[0].avg_cost)).toBe(7);

    const raw = await client.query(
      `SELECT default_cost::text FROM public.raw_materials WHERE id = $1`,
      [rawA],
    );
    expect(Number(raw.rows[0].default_cost)).toBe(20);

    const current = await latest();
    expect(Number(current.latest_cost)).toBe(20);
    expect(current.price_source).toBe('pricing');
    expect(current.reference_number).toMatch(/^PRICE-/);

    await client.query(
      `INSERT INTO public.raw_material_batches
         (raw_material_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, source_type)
       VALUES ($1, $2, $3, $4, -2, 0, 'sale_oversold')`,
      [rawA, branchA, warehouseA, `OV-PRICE-${randomUUID().slice(0, 8)}`],
    );
    const v = await valuation();
    expect(Number(v.estimated_negative_value)).toBe(40);
    expect(Number(v.unpriced_negative_quantity)).toBe(0);
  });

  it('a newer completed purchase replaces pricing as the latest costing price', async () => {
    await client.query(`SELECT pg_sleep(0.02)`);
    const purchaseId = randomUUID();
    const invoice = `NEW-${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO public.purchases
         (id, invoice_number, branch_id, subtotal, total, paid_amount, status, created_at, approved_at)
       VALUES ($1, $2, $3, 30, 30, 30, 'completed', clock_timestamp(), clock_timestamp())`,
      [purchaseId, invoice, branchA],
    );
    await client.query(
      `INSERT INTO public.purchase_items
         (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total, created_at)
       VALUES ($1, $2, 'kg', 1, 30, 30, clock_timestamp())`,
      [purchaseId, rawA],
    );

    const current = await latest();
    expect(Number(current.latest_cost)).toBe(30);
    expect(current.price_source).toBe('purchase');
    expect(current.reference_number).toBe(invoice);
    expect(Number((await valuation()).estimated_negative_value)).toBe(60);
  });

  it('a newer applied stock count replaces the purchase price', async () => {
    await client.query(`SELECT pg_sleep(0.02)`);
    const countId = randomUUID();
    const countNumber = `CNT-${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO public.stock_counts
         (id, branch_id, warehouse_id, status, count_type, count_number, created_at, approved_at, applied_at)
       VALUES ($1, $2, $3, 'applied', 'cycle', $4, clock_timestamp(), clock_timestamp(), clock_timestamp())`,
      [countId, branchA, warehouseA, countNumber],
    );
    await client.query(
      `INSERT INTO public.stock_count_items
         (stock_count_id, raw_material_id, system_quantity, counted_quantity, unit_cost, reason)
       VALUES ($1, $2, 12, 12, 40, 'cost-update')`,
      [countId, rawA],
    );

    const current = await latest();
    expect(Number(current.latest_cost)).toBe(40);
    expect(current.price_source).toBe('stock_count');
    expect(current.reference_number).toBe(countNumber);
    expect(Number((await valuation()).estimated_negative_value)).toBe(80);
  });

  it('a newer manual pricing event becomes authoritative again and history contains all sources', async () => {
    await client.query(`SELECT pg_sleep(0.02)`);
    const result = await asUser(managerUser, async () => {
      const r = await client.query(
        `SELECT public.set_raw_material_price($1, $2, 50, 'final-manual') AS r`,
        [rawA, branchA],
      );
      return r.rows[0].r;
    });
    expect(result.success).toBe(true);

    const current = await latest();
    expect(Number(current.latest_cost)).toBe(50);
    expect(current.price_source).toBe('pricing');
    expect(Number((await valuation()).estimated_negative_value)).toBe(100);

    const history = await asUser(managerUser, async () => {
      const r = await client.query(
        `SELECT unit_cost::text, price_source
           FROM public.get_raw_material_cost_history($1, $2, 20)`,
        [rawA, branchA],
      );
      return r.rows as Array<{ unit_cost: string; price_source: string }>;
    });

    expect(history.slice(0, 4).map((row) => row.price_source)).toEqual([
      'pricing',
      'stock_count',
      'purchase',
      'pricing',
    ]);
    expect(history.slice(0, 4).map((row) => Number(row.unit_cost))).toEqual([50, 40, 30, 20]);
  });

  it('enforces permission and branch scope for manual pricing', async () => {
    const noPermission = await asUser(viewerUser, async () => {
      const r = await client.query(
        `SELECT public.set_raw_material_price($1, $2, 25, NULL) AS r`,
        [rawA, branchA],
      );
      return r.rows[0].r;
    });
    expect(noPermission.success).toBe(false);
    expect(noPermission.error).toBe('PERMISSION_DENIED');

    const wrongBranch = await asUser(managerUser, async () => {
      const r = await client.query(
        `SELECT public.set_raw_material_price($1, $2, 25, NULL) AS r`,
        [rawB, branchB],
      );
      return r.rows[0].r;
    });
    expect(wrongBranch.success).toBe(false);
    expect(wrongBranch.error).toBe('BRANCH_MISMATCH');
  });
});
