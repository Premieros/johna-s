import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { attachRawComponentToUnit, rawQtyForUnit } from './componentTestFixtures';

const dbUrl = getDbUrl();
const skip = !dbUrl;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(skip)('send_to_kitchen concurrency serialization', () => {
  let admin: pg.Client;
  let sessionA: pg.Client;
  let sessionB: pg.Client;

  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();
  const unitId = randomUUID();
  const cashierId = randomUUID();
  const tableId = randomUUID();
  let orderId = '';
  let rawId = '';

  const itemJson = JSON.stringify([
    {
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 100,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 100,
    },
  ]);

  async function beginAsCashier(client: pg.Client): Promise<void> {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]);
    await client.query('SET LOCAL ROLE authenticated');
  }

  async function batchQty(): Promise<number> {
    return rawQtyForUnit(admin, unitId, branchId, warehouseId);
  }

  beforeAll(async () => {
    admin = openDb(dbUrl!);
    sessionA = openDb(dbUrl!);
    sessionB = openDb(dbUrl!);
    await Promise.all([admin.connect(), sessionA.connect(), sessionB.connect()]);

    await admin.query('BEGIN');
    try {
      await admin.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
      await admin.query(
        `INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`,
        [orgId, 'Kitchen concurrency org', `kitchen-concurrency-${randomUUID().slice(0, 8)}`],
      );
      await admin.query(
        `INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`,
        [branchId, 'Kitchen concurrency branch', orgId],
      );
      await admin.query(
        `INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`,
        [warehouseId, 'Kitchen concurrency warehouse', branchId],
      );
      await admin.query(
        `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active)
         VALUES ($1, $2, $3, 100, 50, true)`,
        [productId, 'Kitchen concurrency product', branchId],
      );
      await admin.query(
        `INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
         VALUES ($1, $2, $3, 'ready', $4, 50, 100, true)`,
        [unitId, `KCON-${randomUUID()}`, 'Kitchen concurrency unit', branchId],
      );
      await admin.query(
        `INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`,
        [productId, unitId],
      );
      await admin.query(
        `INSERT INTO public.inventory_unit_batches (unit_id, branch_id, warehouse_id, quantity, unit_cost)
         VALUES ($1, $2, $3, 100, 50)`,
        [unitId, branchId, warehouseId],
      );
      rawId = await attachRawComponentToUnit(admin, unitId, branchId, warehouseId, 100, 50);
      await admin.query(
        `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
         VALUES ($1, $2, $3, 'cashier', $4, true)`,
        [cashierId, `kitchen-concurrency-${randomUUID()}@test.local`, 'Kitchen concurrency cashier', branchId],
      );
      await admin.query(
        `INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active)
         VALUES ($1, $2, 'member', true)`,
        [orgId, cashierId],
      );
      await admin.query(
        `INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status)
         VALUES ($1, $2, 0, 'open')`,
        [branchId, cashierId],
      );
      await admin.query(
        `INSERT INTO public.dining_tables (id, name, branch_id, capacity, status)
         VALUES ($1, $2, $3, 4, 'vacant')`,
        [tableId, `KCON-${tableId.slice(0, 8)}`, branchId],
      );
      await admin.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK').catch(() => {});
      throw error;
    }

    await beginAsCashier(sessionA);
    try {
      const created = await sessionA.query(
        `SELECT public.create_order(
          $1, 'dine_in', $2, NULL, 2, NULL, $3::jsonb,
          100, 0, 'amount', 0, 100, $4
        ) AS r`,
        [branchId, tableId, itemJson, cashierId],
      );
      expect(created.rows[0].r.success).toBe(true);
      orderId = created.rows[0].r.order_id;
      await sessionA.query('COMMIT');
    } catch (error) {
      await sessionA.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });

  afterAll(async () => {
    for (const client of [sessionA, sessionB]) {
      if (!client) continue;
      await client.query('ROLLBACK').catch(() => {});
    }

    if (admin) {
      // These fixtures live only in the disposable Fresh DB used by integration
      // tests. Clean the order-specific rows explicitly so later tests cannot
      // observe this concurrency fixture even if they share the same database.
      if (orderId) {
        await admin.query(`DELETE FROM public.order_kitchen_sends WHERE order_id = $1`, [orderId]).catch(() => {});
        await admin.query(`DELETE FROM public.order_items WHERE order_id = $1`, [orderId]).catch(() => {});
        await admin.query(`DELETE FROM public.orders WHERE id = $1`, [orderId]).catch(() => {});
      }
      await admin.query(`DELETE FROM public.dining_tables WHERE id = $1`, [tableId]).catch(() => {});
      await admin.query(`DELETE FROM public.shifts WHERE branch_id = $1 AND cashier_id = $2`, [branchId, cashierId]).catch(() => {});
      await admin.query(`DELETE FROM public.organization_members WHERE organization_id = $1 AND user_id = $2`, [orgId, cashierId]).catch(() => {});
      await admin.query(`DELETE FROM public.users WHERE id = $1`, [cashierId]).catch(() => {});
      await admin.query(`DELETE FROM public.inventory_unit_batches WHERE unit_id = $1 AND warehouse_id = $2`, [unitId, warehouseId]).catch(() => {});
      await admin.query(`DELETE FROM public.product_unit_links WHERE product_id = $1 AND unit_id = $2`, [productId, unitId]).catch(() => {});
      await admin.query(`DELETE FROM public.inventory_units WHERE id = $1`, [unitId]).catch(() => {});
      if (rawId) {
        await admin.query(`DELETE FROM public.raw_material_batches WHERE raw_material_id = $1`, [rawId]).catch(() => {});
        await admin.query(`DELETE FROM public.raw_materials WHERE id = $1`, [rawId]).catch(() => {});
      }
      await admin.query(`DELETE FROM public.products WHERE id = $1`, [productId]).catch(() => {});
      await admin.query(`DELETE FROM public.warehouses WHERE id = $1`, [warehouseId]).catch(() => {});
      await admin.query(`DELETE FROM public.branches WHERE id = $1`, [branchId]).catch(() => {});
      await admin.query(`DELETE FROM public.organizations WHERE id = $1`, [orgId]).catch(() => {});
    }

    await Promise.all(
      [sessionA, sessionB, admin]
        .filter(Boolean)
        .map((client) => client.end().catch(() => {})),
    );
  });

  it('serializes two simultaneous sends so stock and KDS are affected exactly once', async () => {
    const before = await batchQty();

    await beginAsCashier(sessionA);
    await beginAsCashier(sessionB);

    const first = await sessionA.query(`SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(first.rows[0].r.success).toBe(true);
    expect(first.rows[0].r.items_sent_count).toBe(1);

    let secondSettled = false;
    const secondPending = sessionB
      .query(`SELECT public.send_to_kitchen($1) AS r`, [orderId])
      .then((result) => {
        secondSettled = true;
        return result;
      });

    // sessionA still owns the order row lock. A real concurrent caller must
    // wait here rather than calculating the same positive kitchen delta.
    await pause(100);
    expect(secondSettled).toBe(false);

    await sessionA.query('COMMIT');
    const second = await secondPending;
    await sessionB.query('COMMIT');

    expect(second.rows[0].r.success).toBe(true);
    expect(second.rows[0].r.items_sent_count).toBe(0);
    expect(second.rows[0].r.all_sent).toBe(true);

    expect(await batchQty()).toBe(before - 1);

    const sends = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM public.order_kitchen_sends
        WHERE order_id = $1`,
      [orderId],
    );
    expect(sends.rows[0].count).toBe(1);

    const duplicates = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM (
           SELECT order_item_id
             FROM public.order_kitchen_sends
            WHERE order_id = $1
            GROUP BY order_item_id
           HAVING count(*) > 1
         ) duplicated`,
      [orderId],
    );
    expect(duplicates.rows[0].count).toBe(0);
  });
});
