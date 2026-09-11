import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Nested manufactured units', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const rawId = randomUUID();
  const childUnitId = randomUUID();
  const parentUnitId = randomUUID();
  const testUserId = randomUUID();
  const testEmail = `nested-mfg-${testUserId}@example.test`;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [testUserId]);
    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SAVEPOINT nested_mfg_admin`);
    try {
      const result = await fn();
      await client.query(`RELEASE SAVEPOINT nested_mfg_admin`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT nested_mfg_admin`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT nested_mfg_admin`).catch(() => {});
      throw error;
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Nested MFG Branch')`, [branchId]);
    await client.query(
      `INSERT INTO auth.users (id, email, role, aud, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, $2, 'authenticated', 'authenticated', gen_random_uuid(), '{}'::jsonb, '{}'::jsonb, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [testUserId, testEmail]
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Nested Manufacturing User', 'owner', $3, true)
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, role='owner', branch_id=EXCLUDED.branch_id, is_active=true`,
      [testUserId, testEmail, branchId]
    );
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id) VALUES ($1, 'Nested WH', $2)`, [warehouseId, branchId]);
    await client.query(
      `INSERT INTO public.raw_materials (id, code, name, min_stock, default_cost, is_active, branch_id)
       VALUES ($1, 'RM-NEST', 'Nested Raw', 0, 4, true, $2)`,
      [rawId, branchId]
    );
    await client.query(
      `SELECT public._raw_add($1, $2, $3, 20, 4, 'NEST-RAW', NULL, NULL, 'opening', 'opening', NULL, 'NEST-RAW', $4)`,
      [rawId, branchId, warehouseId, testUserId]
    );
    await client.query(
      `INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, is_active)
       VALUES ($1, 'IU-CHILD', 'Child Sauce', 'manufactured', $3, 0, true),
              ($2, 'IU-PARENT', 'Parent Sauce', 'manufactured', $3, 0, true)`,
      [childUnitId, parentUnitId, branchId]
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipes (unit_id, raw_material_id, quantity, wastage_percent)
       VALUES ($1, $2, 2, 0)`,
      [childUnitId, rawId]
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipe_units (unit_id, component_unit_id, quantity, wastage_percent)
       VALUES ($1, $2, 0.5, 0)`,
      [parentUnitId, childUnitId]
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('consumes a manufactured child unit to produce a parent unit with rolled-up cost', async () => {
    await asAdmin(async () => {
      await q(`SELECT public.produce_inventory_unit($1, 2, $2, $3)`, [childUnitId, warehouseId, branchId]);

      const childBefore = await q<{ qty: string; unit_cost: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS qty, COALESCE(MAX(unit_cost),0)::text AS unit_cost
         FROM public.inventory_unit_batches
         WHERE unit_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
        [childUnitId, branchId, warehouseId]
      );
      expect(Number(childBefore[0].qty)).toBe(2);
      expect(Number(childBefore[0].unit_cost)).toBe(8);

      await q(`SELECT public.produce_inventory_unit($1, 1, $2, $3)`, [parentUnitId, warehouseId, branchId]);

      const childAfter = await q<{ qty: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS qty
         FROM public.inventory_unit_batches
         WHERE unit_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
        [childUnitId, branchId, warehouseId]
      );
      expect(Number(childAfter[0].qty)).toBe(1.5);

      const parent = await q<{ qty: string; unit_cost: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS qty, COALESCE(MAX(unit_cost),0)::text AS unit_cost
         FROM public.inventory_unit_batches
         WHERE unit_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
        [parentUnitId, branchId, warehouseId]
      );
      expect(Number(parent[0].qty)).toBe(1);
      expect(Number(parent[0].unit_cost)).toBe(4);

      const consumption = await q<{ qty: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS qty
         FROM public.inventory_unit_entries
         WHERE unit_id=$1 AND entry_type='production_consumption'`,
        [childUnitId]
      );
      expect(Number(consumption[0].qty)).toBe(-0.5);
    });
  });
});
