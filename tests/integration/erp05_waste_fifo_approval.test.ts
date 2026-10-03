import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('ERP-05 — FIFO-authoritative waste approval', () => {
  let client: pg.Client;

  const branchId = randomUUID();
  const whId = randomUUID();
  const catId = randomUUID();
  const userId = randomUUID();
  const roleName = `erp05_waste_${randomUUID().slice(0, 8)}`;

  const productId = randomUUID();
  const mismatchProductId = randomUUID();
  const unitId = randomUUID();

  async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await client.query(sql, params)).rows as T[];
  }

  async function asApprover<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    await client.query('SAVEPOINT erp05_waste_admin');
    try {
      const result = await fn();
      await client.query('RELEASE SAVEPOINT erp05_waste_admin');
      return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT erp05_waste_admin').catch(() => {});
      await client.query('RELEASE SAVEPOINT erp05_waste_admin').catch(() => {});
      throw error;
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbErrorContaining(fn: () => Promise<unknown>, fragment: string): Promise<void> {
    await client.query('SAVEPOINT erp05_expected_error');
    let message = '';
    try {
      await fn();
    } catch (error) {
      message = String((error as Error).message || error);
    }
    await client.query('ROLLBACK TO SAVEPOINT erp05_expected_error');
    await client.query('RELEASE SAVEPOINT erp05_expected_error');
    expect(message).toContain(fragment);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.branches (id, name) VALUES ($1, 'ERP05 Waste Test')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES ($1, 'ERP05 waste approver', 'ERP05 waste approver',
         '["waste.view","waste.create","waste.approve","waste.report"]'::jsonb,
         'global', true)`,
      [roleName],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'ERP05 Waste Approver', $3, $4, true)`,
      [userId, `${randomUUID()}@test.local`, roleName, branchId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id)
       VALUES ($1, 'ERP05 WH', $2)`,
      [whId, branchId],
    );
    await client.query(
      `INSERT INTO public.waste_categories (id, name, name_en, is_active)
       VALUES ($1, 'ERP05 Test Waste', 'ERP05 Test Waste', true)`,
      [catId],
    );

    await client.query(
      `INSERT INTO public.products (id, name, cost_price, sale_price, is_active, branch_id)
       VALUES ($1, 'ERP05 FIFO Product', 99, 120, true, $2)`,
      [productId, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory (product_id, warehouse_id, quantity, branch_id)
       VALUES ($1, $2, 4, $3)`,
      [productId, whId, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_batches
        (product_id, warehouse_id, branch_id, quantity, unit_cost, expiry_date)
       VALUES
        ($1, $2, $3, 1, 10.00, CURRENT_DATE + 1),
        ($1, $2, $3, 3, 10.01, CURRENT_DATE + 2)`,
      [productId, whId, branchId],
    );

    await client.query(
      `INSERT INTO public.products (id, name, cost_price, sale_price, is_active, branch_id)
       VALUES ($1, 'ERP05 Mismatch Product', 10, 20, true, $2)`,
      [mismatchProductId, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory (product_id, warehouse_id, quantity, branch_id)
       VALUES ($1, $2, 3, $3)`,
      [mismatchProductId, whId, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_batches
        (product_id, warehouse_id, branch_id, quantity, unit_cost, expiry_date)
       VALUES ($1, $2, $3, 1, 7.00, CURRENT_DATE + 1)`,
      [mismatchProductId, whId, branchId],
    );

    await client.query(
      `INSERT INTO public.inventory_units
        (id, code, name, name_en, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'ERP05 Unit', 'ERP05 Unit', 'ready', $3, 99, 0, true)`,
      [unitId, `ERP05-${randomUUID().slice(0, 8)}`, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches
        (unit_id, branch_id, warehouse_id, batch_number, quantity, unit_cost, expiry_date)
       VALUES
        ($1, $2, $3, 'ERP05-U1', 1, 4.00, CURRENT_DATE + 1),
        ($1, $2, $3, 'ERP05-U2', 2, 5.01, CURRENT_DATE + 2)`,
      [unitId, branchId, whId],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('seeds active operational categories and keeps legacy production category inactive', async () => {
    const rows = await q<{ name: string; name_en: string | null; is_active: boolean }>(
      `SELECT name, name_en, is_active
       FROM public.waste_categories
       WHERE name IN ('هالك خامات','هالك منتج','هالك مطبخ','منتهي الصلاحية','تالف','هالك إنتاج')
       ORDER BY name`,
    );
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('هالك خامات')?.is_active).toBe(true);
    expect(byName.get('هالك منتج')?.is_active).toBe(true);
    expect(byName.get('هالك مطبخ')?.is_active).toBe(true);
    expect(byName.get('منتهي الصلاحية')?.is_active).toBe(true);
    expect(byName.get('تالف')?.is_active).toBe(true);
    if (byName.has('هالك إنتاج')) {
      expect(byName.get('هالك إنتاج')?.is_active).toBe(false);
    }
  });

  it('uses actual product FIFO layers for ledger and report cost, not the client estimate', async () => {
    await asApprover(async () => {
      const created = await q<{ create_waste_entry: string }>(
        `SELECT public.create_waste_entry($1,$2,'damaged',3,99,'mixed fifo',NULL,NULL,$3,$4,NULL)`,
        [branchId, catId, productId, whId],
      );
      const wasteId = created[0].create_waste_entry;

      const pending = await q<{ employee_id: string; unit_cost: string }>(
        `SELECT employee_id::text, unit_cost::text
         FROM public.waste_entries WHERE id=$1`,
        [wasteId],
      );
      expect(pending[0].employee_id).toBe(userId);
      expect(Number(pending[0].unit_cost)).toBe(99);

      await client.query(`SELECT public.approve_waste($1, true)`, [wasteId]);

      const balance = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.inventory
         WHERE product_id=$1 AND warehouse_id=$2 AND branch_id=$3`,
        [productId, whId, branchId],
      );
      expect(Number(balance[0].quantity)).toBe(1);

      const batches = await q<{ unit_cost: string; quantity: string }>(
        `SELECT unit_cost::text, quantity::text
         FROM public.inventory_batches
         WHERE product_id=$1 AND warehouse_id=$2 AND branch_id=$3
         ORDER BY expiry_date, id`,
        [productId, whId, branchId],
      );
      expect(batches.map((row) => Number(row.quantity))).toEqual([0, 1]);

      const ledger = await q<{ quantity: string; unit_cost: string; total_cost: string }>(
        `SELECT quantity::text, unit_cost::text, total_cost::text
         FROM public.inventory_ledger
         WHERE entry_type='waste' AND reference_type='waste' AND reference_id=$1`,
        [wasteId],
      );
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].quantity)).toBe(-3);
      expect(Number(ledger[0].unit_cost)).toBeCloseTo(10.006667, 6);
      expect(Number(ledger[0].total_cost)).toBe(-30.02);

      const entry = await q<{ unit_cost: string; total_cost: string; approved_total_cost: string; status: string }>(
        `SELECT unit_cost::text, total_cost::text, approved_total_cost::text, status
         FROM public.waste_entries WHERE id=$1`,
        [wasteId],
      );
      expect(entry[0].status).toBe('approved');
      expect(Number(entry[0].unit_cost)).toBe(10.01);
      expect(Number(entry[0].total_cost)).toBe(30.03);
      expect(Number(entry[0].approved_total_cost)).toBe(30.02);

      const report = await q<{ total_cost: string }>(
        `SELECT total_cost::text
         FROM public.get_waste_report(
           $1,
           (now() AT TIME ZONE 'Africa/Cairo')::date - 1,
           (now() AT TIME ZONE 'Africa/Cairo')::date
         )
         WHERE waste_category='ERP05 Test Waste' AND waste_type='damaged'`,
        [branchId],
      );
      expect(report).toHaveLength(1);
      expect(Number(report[0].total_cost)).toBe(30.02);
    });
  });

  it('writes inventory-unit waste per consumed FIFO layer and reports the exact movement cost', async () => {
    await asApprover(async () => {
      const created = await q<{ create_waste_entry: string }>(
        `SELECT public.create_waste_entry($1,$2,'raw_material',2,99,'unit fifo',NULL,$3,NULL,$4,NULL)`,
        [branchId, catId, unitId, whId],
      );
      const wasteId = created[0].create_waste_entry;

      await client.query(`SELECT public.approve_waste($1, true)`, [wasteId]);

      const movements = await q<{ quantity: string; unit_cost: string; batch_number: string }>(
        `SELECT quantity::text, unit_cost::text, batch_number
         FROM public.inventory_unit_entries
         WHERE entry_type='waste' AND reference_type='waste' AND reference_id=$1
         ORDER BY unit_cost, batch_number`,
        [wasteId],
      );
      expect(movements).toHaveLength(2);
      expect(movements.map((row) => [Number(row.quantity), Number(row.unit_cost)])).toEqual([
        [-1, 4],
        [-1, 5.01],
      ]);

      const approved = await q<{ approved_total_cost: string }>(
        `SELECT approved_total_cost::text FROM public.waste_entries WHERE id=$1`,
        [wasteId],
      );
      expect(Number(approved[0].approved_total_cost)).toBe(9.01);

      const report = await q<{ total_cost: string }>(
        `SELECT total_cost::text
         FROM public.get_waste_report(
           $1,
           (now() AT TIME ZONE 'Africa/Cairo')::date - 1,
           (now() AT TIME ZONE 'Africa/Cairo')::date
         )
         WHERE waste_category='ERP05 Test Waste' AND waste_type='raw_material'`,
        [branchId],
      );
      expect(report).toHaveLength(1);
      expect(Number(report[0].total_cost)).toBe(9.01);
    });
  });

  it('fails closed when aggregate product stock is not covered by FIFO batches', async () => {
    await asApprover(async () => {
      const created = await q<{ create_waste_entry: string }>(
        `SELECT public.create_waste_entry($1,$2,'damaged',2,7,'mismatch',NULL,NULL,$3,$4,NULL)`,
        [branchId, catId, mismatchProductId, whId],
      );
      const wasteId = created[0].create_waste_entry;

      await expectDbErrorContaining(
        () => client.query(`SELECT public.approve_waste($1, true)`, [wasteId]),
        'FIFO_BATCH_COVERAGE_MISMATCH:product',
      );

      const inventory = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.inventory
         WHERE product_id=$1 AND warehouse_id=$2 AND branch_id=$3`,
        [mismatchProductId, whId, branchId],
      );
      expect(Number(inventory[0].quantity)).toBe(3);

      const batch = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.inventory_batches
         WHERE product_id=$1 AND warehouse_id=$2 AND branch_id=$3`,
        [mismatchProductId, whId, branchId],
      );
      expect(Number(batch[0].quantity)).toBe(1);

      const entry = await q<{ status: string }>(
        `SELECT status FROM public.waste_entries WHERE id=$1`,
        [wasteId],
      );
      expect(entry[0].status).toBe('pending');

      const ledger = await q(
        `SELECT id FROM public.inventory_ledger
         WHERE entry_type='waste' AND reference_type='waste' AND reference_id=$1`,
        [wasteId],
      );
      expect(ledger).toHaveLength(0);
    });
  });

  it('rejects legacy production waste and keeps SECURITY DEFINER ACLs closed to anon/public', async () => {
    await asApprover(async () => {
      await expectDbErrorContaining(
        () => client.query(
          `SELECT public.create_waste_entry($1,$2,'production',1,1,NULL,NULL,NULL,$3,$4,NULL)`,
          [branchId, catId, productId, whId],
        ),
        'LEGACY_PRODUCTION_WASTE_READ_ONLY',
      );
    });

    const acl = await q<{ anon_create: boolean; anon_approve: boolean; anon_report: boolean }>(
      `SELECT
         has_function_privilege('anon', 'public.create_waste_entry(uuid,uuid,text,numeric,numeric,text,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE') AS anon_create,
         has_function_privilege('anon', 'public.approve_waste(uuid,boolean,text)', 'EXECUTE') AS anon_approve,
         has_function_privilege('anon', 'public.get_waste_report(uuid,date,date)', 'EXECUTE') AS anon_report`,
    );
    expect(acl[0]).toEqual({
      anon_create: false,
      anon_approve: false,
      anon_report: false,
    });
  });
});
