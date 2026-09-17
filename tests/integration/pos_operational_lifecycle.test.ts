import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  sale_id?: string;
  request_id?: string;
  status?: string;
  items_sent_count?: number;
};

describe.skipIf(skip)('POS operational lifecycle release gate', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const productId = randomUUID();
  const unitId = randomUUID();

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<RpcResult> => {
    const rows = await asUser(userId, sql, params);
    return (rows[0]?.r || {}) as RpcResult;
  };

  const batchQty = async (): Promise<number> => {
    const r = await client.query<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS quantity
         FROM public.inventory_unit_batches
        WHERE unit_id = $1 AND warehouse_id = $2`,
      [unitId, ids.whA],
    );
    return Number(r.rows[0]?.quantity || 0);
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    // The shared RLS fixture intentionally carries an open order only for policy probes.
    // Mark that unrelated probe settled so the lifecycle test exercises its own order.
    await client.query(
      `UPDATE public.orders
          SET payment_status = 'paid', payment_at = now()
        WHERE id = $1`,
      [ids.rows.orders.own],
    );

    // The shared RLS fixture also creates warehouse rows used only for policy
    // probes. Pin the real operational warehouse so kitchen inventory always
    // resolves to the warehouse where this release-gate stock is seeded.
    await client.query(
      `UPDATE public.warehouses SET is_default = (id = $1::uuid) WHERE branch_id = $2::uuid`,
      [ids.whA, ids.branchA],
    );

    // The shared RLS fixture contains an open cashier shift for isolation tests.
    // Close only that fixture row directly, then exercise the real open/close RPCs below.
    // No synthetic closing amount is written here: the canonical shifts schema stores
    // the counted close value through the server-authoritative close RPC itself.
    await client.query(
      `UPDATE public.shifts SET status = 'closed', closed_at = now() WHERE id = $1`,
      [ids.shiftA],
    );

    // Use a dedicated lifecycle product so unrelated shared-fixture recipes cannot
    // accidentally add raw-material requirements to this linked-unit sale path.
    await client.query(
      `INSERT INTO public.products
         (id, name, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, 'Lifecycle sale product', $2, 10, 20, true)`,
      [productId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_units
         (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'Lifecycle ready unit', 'ready', $3, 10, 20, true)`,
      [unitId, `LIFE-${randomUUID()}`, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.product_unit_links(product_id, unit_id, quantity) VALUES ($1, $2, 1)`,
      [productId, unitId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches(unit_id, branch_id, warehouse_id, quantity, unit_cost)
       VALUES ($1, $2, $3, 10, 10)`,
      [unitId, ids.branchA, ids.whA],
    );
    await client.query(`UPDATE public.settings SET tax_enabled = false, tax_rate = 0`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('runs login-context → shift → order → KDS → sale → refund approval → close shift', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    // Login context: CI auth.stub maps auth.uid() to app.user_id; runAsPersist
    // switches to authenticated and sets the cashier identity exactly as RLS sees it.
    const open = await rpc(
      ids.users.cashier,
      `SELECT public.open_shift($1, $2, $3) AS r`,
      [ids.branchA, 50, 'Operational lifecycle gate'],
    );
    expect(open.success).toBe(true);

    const shiftRow = await client.query<{ id: string; status: string; opening_amount: string }>(
      `SELECT id, status, opening_amount::text FROM public.shifts
        WHERE branch_id = $1 AND cashier_id = $2 AND status = 'open'
        ORDER BY opened_at DESC LIMIT 1`,
      [ids.branchA, ids.users.cashier],
    );
    expect(shiftRow.rows).toHaveLength(1);
    expect(shiftRow.rows[0].status).toBe('open');
    expect(Number(shiftRow.rows[0].opening_amount)).toBe(50);
    const shiftId = shiftRow.rows[0].id;

    const items = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 9999, // deliberately spoofed; DB must use catalog price (20)
      discount_amount: 0,
      bonus_quantity: 0,
      total: 9999,
    }]);

    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_order($1, 'takeaway', NULL, NULL, NULL, NULL, $2::jsonb, 9999, 0, 'amount', 0, 9999, $3) AS r`,
      [ids.branchA, items, ids.users.cashier],
    );
    expect(created.success).toBe(true);
    expect(created.order_id).toBeTruthy();
    const orderId = String(created.order_id);

    const authoritativeOrder = await client.query<{ subtotal: string; total: string; unit_price: string }>(
      `SELECT o.subtotal::text, o.total::text, oi.unit_price::text
         FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
        WHERE o.id = $1`,
      [orderId],
    );
    expect(Number(authoritativeOrder.rows[0].unit_price)).toBe(20);
    expect(Number(authoritativeOrder.rows[0].subtotal)).toBe(20);
    expect(Number(authoritativeOrder.rows[0].total)).toBe(20);

    const stockBeforeKds = await batchQty();
    const sent = await rpc(ids.users.cashier, `SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(sent.success).toBe(true);
    expect(sent.items_sent_count).toBe(1);
    expect(await batchQty()).toBe(stockBeforeKds - 1); // Kitchen send is the stock boundary.

    const invoice = `LIFE-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sale = await rpc(
      ids.users.cashier,
      `SELECT public.process_sale(
         p_invoice_number := $1,
         p_branch_id := $2,
         p_shift_id := $3,
         p_warehouse_id := $4,
         p_customer_id := NULL,
         p_salesperson_id := $5,
         p_subtotal := 9999,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 999,
         p_bonus_amount := 0,
         p_total := 10998,
         p_paid_amount := 10998,
         p_payment_method := 'cash',
         p_status := 'completed',
         p_items := $6::jsonb,
         p_order_type := 'takeaway',
         p_table_id := NULL,
         p_order_id := $7
       ) AS r`,
      [invoice, ids.branchA, shiftId, ids.whA, ids.users.cashier, items, orderId],
    );
    expect(sale.success, `process_sale returned: ${JSON.stringify(sale)}`).toBe(true);
    expect(sale.sale_id).toBeTruthy();
    const saleId = String(sale.sale_id);

    const settled = await client.query<{ total: string; paid_amount: string; status: string; order_status: string }>(
      `SELECT s.total::text, s.paid_amount::text, s.status, o.status AS order_status
         FROM public.sales s JOIN public.orders o ON o.id = $2
        WHERE s.id = $1`,
      [saleId, orderId],
    );
    expect(Number(settled.rows[0].total)).toBe(20);
    expect(Number(settled.rows[0].paid_amount)).toBe(20);
    expect(settled.rows[0].status).toBe('completed');
    expect(settled.rows[0].order_status).toBe('completed');
    expect(await batchQty()).toBe(stockBeforeKds - 1); // Payment does not deduct a second time.

    const saleItem = await client.query<{ id: string; quantity: string; total: string }>(
      `SELECT id, quantity::text, total::text FROM public.sale_items WHERE sale_id = $1 LIMIT 1`,
      [saleId],
    );
    const saleItemId = saleItem.rows[0].id;
    const refundItems = JSON.stringify([{ sale_item_id: saleItemId, quantity: 1 }]);
    const refundTotal = Number(saleItem.rows[0].total);

    const blockedRefund = await rpc(
      ids.users.cashier,
      `SELECT public.process_refund($1, $2::jsonb, $3) AS r`,
      [saleId, refundItems, 'Lifecycle full refund'],
    );
    expect(blockedRefund.success).toBe(false);
    expect(blockedRefund.error).toBe('APPROVAL_REQUIRED');

    const request = await rpc(
      ids.users.cashier,
      `SELECT public.request_manager_approval($1, $2, $3, $4::jsonb, $5) AS r`,
      [
        'refund',
        'sale',
        saleId,
        JSON.stringify({
          items: [{ sale_item_id: saleItemId, quantity: 1 }],
          reason: 'Lifecycle full refund',
          refund_total: refundTotal,
          invoice_number: invoice,
        }),
        'Lifecycle full refund',
      ],
    );
    expect(request.success).toBe(true);
    expect(request.request_id).toBeTruthy();

    const approved = await rpc(
      ids.users.branch_manager,
      `SELECT public.decide_manager_approval($1, true, $2) AS r`,
      [request.request_id, 'Lifecycle approval'],
    );
    expect(approved.success).toBe(true);
    expect(approved.status).toBe('approved');

    const refunded = await rpc(
      ids.users.cashier,
      `SELECT public.process_refund($1, $2::jsonb, $3) AS r`,
      [saleId, refundItems, 'Lifecycle full refund'],
    );
    expect(refunded.success).toBe(true);

    const approvalRow = await client.query<{ status: string }>(
      `SELECT status FROM public.approval_requests WHERE id = $1`,
      [request.request_id],
    );
    expect(approvalRow.rows[0].status).toBe('consumed');
    expect(await batchQty()).toBe(stockBeforeKds); // full refund restores aggregate stock across batches.

    await client.query(
      `UPDATE public.orders SET status = 'completed', payment_status = 'paid'
       WHERE branch_id = $1 AND status IN ('open', 'held')`,
      [ids.branchA],
    );

    const closed = await rpc(
      ids.users.cashier,
      `SELECT public.close_shift($1, $2, $3) AS r`,
      [shiftId, 50, 'Operational lifecycle complete'],
    );
    expect(closed.success).toBe(true);

    const finalShift = await client.query<{ status: string }>(`SELECT status FROM public.shifts WHERE id = $1`, [shiftId]);
    expect(finalShift.rows[0].status).toBe('closed');

    const ops = await client.query<{ operation_type: string }>(
      `SELECT operation_type FROM public.shift_operations WHERE shift_id = $1 ORDER BY created_at`,
      [shiftId],
    );
    expect(ops.rows.map((r) => r.operation_type)).toEqual(expect.arrayContaining(['sale', 'refund']));
  });
});
