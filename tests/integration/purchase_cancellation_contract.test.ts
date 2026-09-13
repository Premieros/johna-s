import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('purchase cancellation contract', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
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

  async function createDraftPurchase() {
    return asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; purchase_id?: string } }>(
        `SELECT public.create_purchase_order(
          $1, $2, $3, 'credit', 'cancellation regression',
          $4::jsonb, NULL
        ) AS r`,
        [branchId, supplierId, warehouseId, JSON.stringify([
          { product_id: productId, quantity: 2, unit_cost: 20, unit_name: 'piece' },
        ])],
      );
      expect(res.rows[0].r.success).toBe(true);
      expect(res.rows[0].r.purchase_id).toBeTruthy();
      return res.rows[0].r.purchase_id!;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Purchase Cancel Branch')`, [branchId]);
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES ($1, 'Purchase Cancel WH', $2, true)`,
      [warehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Purchase Cancel Admin', 'super_admin', $3, true)`,
      [adminId, `purchase-cancel-${adminId}@example.test`, branchId],
    );
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active)
       VALUES ($1, 'Purchase Cancel Product', $2, 100, 20, true)`,
      [productId, branchId],
    );
    await client.query(
      `INSERT INTO public.suppliers (id, name, branch_id, balance)
       VALUES ($1, 'Purchase Cancel Supplier', $2, 0)`,
      [supplierId, branchId],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('allows cancellation before approval without creating inventory or accounting side effects', async () => {
    const purchaseId = await createDraftPurchase();

    const cancelled = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.update_purchase_order_status($1, 'cancelled') AS r`,
        [purchaseId],
      );
      return res.rows[0].r;
    });

    expect(cancelled.success).toBe(true);

    const row = await client.query<{ status: string }>(`SELECT status FROM public.purchases WHERE id = $1`, [purchaseId]);
    expect(row.rows[0].status).toBe('cancelled');

    const receipts = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.purchase_receipts WHERE purchase_id = $1`,
      [purchaseId],
    );
    const journals = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.journal_entries WHERE reference_type = 'purchase' AND reference_id = $1`,
      [purchaseId],
    );
    expect(Number(receipts.rows[0].count)).toBe(0);
    expect(Number(journals.rows[0].count)).toBe(0);
  });

  it('rejects cancellation after approval and preserves the approved document state', async () => {
    const purchaseId = await createDraftPurchase();

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

    const cancelled = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.update_purchase_order_status($1, 'cancelled') AS r`,
        [purchaseId],
      );
      return res.rows[0].r;
    });

    expect(cancelled.success).toBe(false);
    expect(cancelled.error).toBe('BAD_TRANSITION');

    const row = await client.query<{ status: string }>(`SELECT status FROM public.purchases WHERE id = $1`, [purchaseId]);
    expect(row.rows[0].status).toBe('approved');
  });
});
