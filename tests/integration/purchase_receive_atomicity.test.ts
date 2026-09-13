import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('purchase receive atomicity', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const productId = randomUUID();
  const supplierId = randomUUID();
  const adminId = randomUUID();

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [adminId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
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

    await client.query(
      `INSERT INTO public.branches (id, name) VALUES ($1, 'Receive Atomicity Branch')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Receive Atomicity Admin', 'super_admin', $3, true)`,
      [adminId, `receive-atomicity-${adminId}@example.test`, branchId],
    );
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active)
       VALUES ($1, 'Receive Atomicity Product', $2, 100, 20, true)`,
      [productId, branchId],
    );
    await client.query(
      `INSERT INTO public.suppliers (id, name, branch_id, balance)
       VALUES ($1, 'Receive Atomicity Supplier', $2, 0)`,
      [supplierId, branchId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  it('does not create a GRN or mutate received quantity when the PO has no warehouse', async () => {
    const created = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; purchase_id?: string; error?: string } }>(
        `SELECT public.create_purchase_order(
          $1, $2, NULL, 'cash', 'atomicity regression',
          $3::jsonb, NULL
        ) AS r`,
        [branchId, supplierId, JSON.stringify([
          { product_id: productId, quantity: 2, unit_cost: 20, unit_name: 'piece' },
        ])],
      );
      return res.rows[0].r;
    });

    expect(created.success).toBe(true);
    expect(created.purchase_id).toBeTruthy();
    const purchaseId = created.purchase_id!;

    await asAdmin(async () => {
      const submitted = await client.query<{ r: { success: boolean } }>(
        `SELECT public.update_purchase_order_status($1, 'submitted') AS r`,
        [purchaseId],
      );
      expect(submitted.rows[0].r.success).toBe(true);

      const approved = await client.query<{ r: { success: boolean } }>(
        `SELECT public.update_purchase_order_status($1, 'approved') AS r`,
        [purchaseId],
      );
      expect(approved.rows[0].r.success).toBe(true);
    });

    const item = await client.query<{ id: string; received_quantity: string }>(
      `SELECT id, received_quantity::text
       FROM public.purchase_items
       WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(item.rows).toHaveLength(1);
    expect(Number(item.rows[0].received_quantity)).toBe(0);

    const failed = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [purchaseId, JSON.stringify([
          { purchase_item_id: item.rows[0].id, quantity_received: 1 },
        ])],
      );
      return res.rows[0].r;
    });

    expect(failed.success).toBe(false);
    expect(failed.error).toBe('WAREHOUSE_REQUIRED');

    const receiptCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.purchase_receipts WHERE purchase_id = $1`,
      [purchaseId],
    );
    expect(Number(receiptCount.rows[0].count)).toBe(0);

    const receivedAfter = await client.query<{ received_quantity: string }>(
      `SELECT received_quantity::text FROM public.purchase_items WHERE id = $1`,
      [item.rows[0].id],
    );
    expect(Number(receivedAfter.rows[0].received_quantity)).toBe(0);

    const inventoryRows = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM public.product_inventory
       WHERE product_id = $1 AND branch_id = $2`,
      [productId, branchId],
    );
    expect(Number(inventoryRows.rows[0].count)).toBe(0);
  });
});
