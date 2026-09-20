import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Phase 2 — waste center', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const whId = randomUUID();
  const catId = randomUUID();
  const productId = randomUUID();
  const adminUser = randomUUID();
  const adminRole = `phase2_waste_${randomUUID().slice(0, 8)}`;
  let wasteId: string;

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [adminUser]);
    await client.query(`SET LOCAL ROLE authenticated`);
    await client.query(`SAVEPOINT phase2_waste_admin`);
    try {
      const result = await fn();
      await client.query(`RELEASE SAVEPOINT phase2_waste_admin`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT phase2_waste_admin`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT phase2_waste_admin`).catch(() => {});
      throw error;
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(fn: () => Promise<unknown>): Promise<void> {
    const savepoint = 'phase2_waste_expected_error';
    await client.query(`SAVEPOINT ${savepoint}`);
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    expect(threw).toBe(true);
  }

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Phase2 Test')`, [branchId]);
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES ($1, 'Phase2 waste approver', 'Phase2 waste approver', '["waste.view","waste.create","waste.approve","waste.report"]'::jsonb, 'global', true)`,
      [adminRole],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Phase2 Waste Approver', $3, $4, true)`,
      [adminUser, `${randomUUID()}@test.local`, adminRole, branchId],
    );
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id) VALUES ($1, 'WH', $2)`, [whId, branchId]);
    await client.query(`INSERT INTO public.products (id, name, cost_price, sale_price, is_active, branch_id) VALUES ($1, 'Waste Product', 10, 20, true, $2)`, [productId, branchId]);
    await client.query(
      `INSERT INTO public.inventory (product_id, warehouse_id, quantity, branch_id) VALUES ($1, $2, 20, $3)`,
      [productId, whId, branchId],
    );
    await client.query(`INSERT INTO public.waste_categories (id, name, name_en) VALUES ($1, 'Test Waste', 'Test Waste')`, [catId]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('waste_categories table exists with correct columns', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='waste_categories' AND table_schema='public' ORDER BY ordinal_position`
    );
    const names = cols.map(c => c.column_name);
    expect(names).toContain('id');
    expect(names).toContain('name');
    expect(names).toContain('is_active');
  });

  it('waste_entries table exists with correct columns', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='waste_entries' AND table_schema='public' ORDER BY ordinal_position`
    );
    const names = cols.map(c => c.column_name);
    expect(names).toContain('waste_category_id');
    expect(names).toContain('waste_type');
    expect(names).toContain('quantity');
    expect(names).toContain('unit_cost');
    expect(names).toContain('total_cost');
    expect(names).toContain('status');
  });

  it('create_waste_entry RPC creates a pending entry', async () => {
    await asAdmin(async () => {
      const result = await q<{ create_waste_entry: string }>(
        `SELECT public.create_waste_entry($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,NULL)`,
        [branchId, catId, 'damaged', 5, 10, 'Test waste', productId, whId]
      );
      wasteId = result[0].create_waste_entry;
      expect(wasteId).toBeTruthy();

      const rows = await q<{ status: string; waste_type: string; quantity: string }>(
        `SELECT status, waste_type, quantity::text FROM public.waste_entries WHERE id = $1`, [wasteId]
      );
      expect(rows[0].status).toBe('pending');
      expect(rows[0].waste_type).toBe('damaged');
    });
  });

  it('approve_waste RPC sets status to approved', async () => {
    await asAdmin(async () => {
      await client.query(`SELECT public.approve_waste($1, true)`, [wasteId]);
      const rows = await q<{ status: string }>(
        `SELECT status FROM public.waste_entries WHERE id = $1`, [wasteId]
      );
      expect(rows[0].status).toBe('approved');
      const balance = await q<{ quantity: string }>(`SELECT quantity::text FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2`, [productId, whId]);
      expect(Number(balance[0].quantity)).toBe(15);
      const ledger = await q<{ quantity: string }>(`SELECT quantity::text FROM public.inventory_ledger WHERE reference_type='waste' AND reference_id=$1`, [wasteId]);
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].quantity)).toBe(-5);
    });
  });

  it('approve_waste rejects if already approved', async () => {
    await asAdmin(async () => {
      await expectDbError(() =>
        client.query(`SELECT public.approve_waste($1, true)`, [wasteId])
      );
    });
  });

  it('get_waste_report returns grouped results', async () => {
    await asAdmin(async () => {
      const rows = await q<{ waste_category: string; total_cost: string }>(
        `SELECT waste_category, total_cost FROM public.get_waste_report($1, (now() AT TIME ZONE 'Africa/Cairo')::date - 1, (now() AT TIME ZONE 'Africa/Cairo')::date)`,
        [branchId]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].waste_category).toBe('Test Waste');
    });
  });

  it('waste_entries has generated total_cost column', async () => {
    await asAdmin(async () => {
      const rows = await q<{ quantity: string; unit_cost: string; total_cost: string }>(
        `SELECT quantity::text, unit_cost::text, total_cost::text FROM public.waste_entries WHERE id = $1`, [wasteId]
      );
      const expected = Number(rows[0].quantity) * Number(rows[0].unit_cost);
      expect(Number(rows[0].total_cost)).toBeCloseTo(expected, 2);
    });
  });

  it('create_waste_entry rejects invalid waste_type', async () => {
    await asAdmin(async () => {
      await expectDbError(() =>
        client.query(`SELECT public.create_waste_entry($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,NULL)`, [branchId, catId, 'invalid', 1, 1, null, productId, whId])
      );
    });
  });
});
