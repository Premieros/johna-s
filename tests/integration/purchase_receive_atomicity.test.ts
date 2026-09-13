import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('purchase receive atomicity', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
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

  async function createApprovedPurchase(warehouse: string | null, quantity = 2) {
    const created = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; purchase_id?: string; error?: string } }>(
        `SELECT public.create_purchase_order(
          $1, $2, $3, 'credit', 'receive atomicity regression',
          $4::jsonb, NULL
        ) AS r`,
        [branchId, supplierId, warehouse, JSON.stringify([
          { product_id: productId, quantity, unit_cost: 20, unit_name: 'piece' },
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

    return { purchaseId, purchaseItemId: item.rows[0].id };
  }

  async function receiptArtifacts(purchaseId: string) {
    const receipts = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.purchase_receipts WHERE purchase_id = $1`,
      [purchaseId],
    );
    const journals = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM public.journal_entries
       WHERE reference_type = 'purchase' AND reference_id = $1`,
      [purchaseId],
    );
    return {
      receipts: Number(receipts.rows[0].count),
      journals: Number(journals.rows[0].count),
    };
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'Receive Atomicity Branch'), ($2, 'Receive Atomicity Other Branch')`,
      [branchId, otherBranchId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES ($1, 'Receive Atomicity WH', $2, true),
              ($3, 'Receive Atomicity Foreign WH', $4, true)`,
      [warehouseId, branchId, otherWarehouseId, otherBranchId],
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

    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  it('does not create a GRN or mutate received quantity when the PO has no warehouse', async () => {
    const { purchaseId, purchaseItemId } = await createApprovedPurchase(null);

    const failed = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [purchaseId, JSON.stringify([
          { purchase_item_id: purchaseItemId, quantity_received: 1 },
        ])],
      );
      return res.rows[0].r;
    });

    expect(failed.success).toBe(false);
    expect(failed.error).toBe('WAREHOUSE_REQUIRED');

    const artifacts = await receiptArtifacts(purchaseId);
    expect(artifacts).toEqual({ receipts: 0, journals: 0 });

    const receivedAfter = await client.query<{ received_quantity: string }>(
      `SELECT received_quantity::text FROM public.purchase_items WHERE id = $1`,
      [purchaseItemId],
    );
    expect(Number(receivedAfter.rows[0].received_quantity)).toBe(0);

    const inventoryRows = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM public.inventory_batches
       WHERE product_id = $1 AND branch_id = $2`,
      [productId, branchId],
    );
    expect(Number(inventoryRows.rows[0].count)).toBe(0);
  });

  it('rejects a foreign-branch warehouse before any receipt side effect', async () => {
    const { purchaseId, purchaseItemId } = await createApprovedPurchase(warehouseId);

    // Simulate a legacy/corrupt PO reference. The receive boundary itself must
    // fail closed even if an older row contains a warehouse from another branch.
    await client.query(`UPDATE public.purchases SET warehouse_id = $1 WHERE id = $2`, [otherWarehouseId, purchaseId]);

    const failed = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [purchaseId, JSON.stringify([
          { purchase_item_id: purchaseItemId, quantity_received: 1 },
        ])],
      );
      return res.rows[0].r;
    });

    expect(failed.success).toBe(false);
    expect(failed.error).toBe('WAREHOUSE_BRANCH_MISMATCH');
    expect(await receiptArtifacts(purchaseId)).toEqual({ receipts: 0, journals: 0 });

    const receivedAfter = await client.query<{ received_quantity: string }>(
      `SELECT received_quantity::text FROM public.purchase_items WHERE id = $1`,
      [purchaseItemId],
    );
    expect(Number(receivedAfter.rows[0].received_quantity)).toBe(0);
  });

  it('posts to the PO warehouse/AP supplier once and keeps a completed retry side-effect free', async () => {
    const { purchaseId, purchaseItemId } = await createApprovedPurchase(warehouseId, 2);

    const received = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; status?: string; fully_received?: boolean } }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [purchaseId, JSON.stringify([
          { purchase_item_id: purchaseItemId, quantity_received: 2 },
        ])],
      );
      return res.rows[0].r;
    });

    expect(received.success).toBe(true);
    expect(received.status).toBe('completed');
    expect(received.fully_received).toBe(true);

    const destinationStock = await client.query<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS qty
       FROM public.inventory_batches
       WHERE product_id = $1 AND branch_id = $2 AND warehouse_id = $3`,
      [productId, branchId, warehouseId],
    );
    expect(Number(destinationStock.rows[0].qty)).toBe(2);

    const foreignStock = await client.query<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS qty
       FROM public.inventory_batches
       WHERE product_id = $1 AND warehouse_id = $2`,
      [productId, otherWarehouseId],
    );
    expect(Number(foreignStock.rows[0].qty)).toBe(0);

    const apSupplierLines = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM public.journal_entry_lines l
       JOIN public.journal_entries j ON j.id = l.journal_entry_id
       WHERE j.reference_type = 'purchase'
         AND j.reference_id = $1
         AND l.supplier_id = $2
         AND l.credit > 0`,
      [purchaseId, supplierId],
    );
    expect(Number(apSupplierLines.rows[0].count)).toBeGreaterThan(0);

    const beforeRetry = await receiptArtifacts(purchaseId);
    const stockBeforeRetry = Number(destinationStock.rows[0].qty);

    const replay = await asAdmin(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb) AS r`,
        [purchaseId, JSON.stringify([
          { purchase_item_id: purchaseItemId, quantity_received: 1 },
        ])],
      );
      return res.rows[0].r;
    });

    expect(replay.success).toBe(false);
    expect(replay.error).toBe('NOT_RECEIVABLE');
    expect(await receiptArtifacts(purchaseId)).toEqual(beforeRetry);

    const stockAfterRetry = await client.query<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS qty
       FROM public.inventory_batches
       WHERE product_id = $1 AND branch_id = $2 AND warehouse_id = $3`,
      [productId, branchId, warehouseId],
    );
    expect(Number(stockAfterRetry.rows[0].qty)).toBe(stockBeforeRetry);

    const receivedAfterRetry = await client.query<{ received_quantity: string }>(
      `SELECT received_quantity::text FROM public.purchase_items WHERE id = $1`,
      [purchaseItemId],
    );
    expect(Number(receivedAfterRetry.rows[0].received_quantity)).toBe(2);
  });

  it('keeps the PO row lock ahead of receipt writes for concurrent receive serialization', async () => {
    const def = await client.query<{ definition: string }>(
      `SELECT pg_get_functiondef('public.receive_purchase_order(uuid,jsonb)'::regprocedure) AS definition`,
    );
    const sql = def.rows[0].definition;
    const lockAt = sql.indexOf('FOR UPDATE');
    const receiptWriteAt = sql.indexOf('INSERT INTO public.purchase_receipts');
    expect(lockAt).toBeGreaterThan(-1);
    expect(receiptWriteAt).toBeGreaterThan(lockAt);
  });
});
