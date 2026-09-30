import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('KDS served-order incremental resend', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const orderId = randomUUID();
  const itemId = randomUUID();
  const productId = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Served resend test')`, [branchId]);
    await client.query(
      `INSERT INTO public.products (id, branch_id, name, sale_price, is_active)
       VALUES ($1, $2, 'Served resend product', 10, true)`,
      [productId, branchId],
    );
    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, status, kitchen_status)
       VALUES ($1, 'ORD-SERVED-RESEND', $2, 'open', 'sent')`,
      [orderId, branchId],
    );
    await client.query(
      `INSERT INTO public.order_items
       (id, order_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
       VALUES ($1, $2, $3, 'piece', 1, 10, 0, 0, 10)`,
      [itemId, orderId, productId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_sends
       (branch_id, order_id, order_item_id, sent_at, sent_quantity)
       VALUES ($1, $2, $3, now(), 1)`,
      [branchId, orderId, itemId],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('records the served baseline when kitchen marks an order served', async () => {
    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SELECT public.set_kitchen_status($1, 'served')`, [orderId]);
    await client.query(`RESET ROLE`);

    const rows = await q<{ served_quantity: string }>(
      `SELECT served_quantity::text
       FROM public.order_kitchen_served_quantities
       WHERE order_id=$1 AND order_item_id=$2`,
      [orderId, itemId],
    );
    expect(Number(rows[0]?.served_quantity)).toBe(1);
  });

  it('shows only quantity above the served baseline after the order reopens', async () => {
    await client.query(
      `UPDATE public.order_items SET quantity=2, total=20 WHERE id=$1`,
      [itemId],
    );
    await client.query(
      `UPDATE public.order_kitchen_sends
       SET sent_quantity=2, sent_at=now()
       WHERE order_item_id=$1`,
      [itemId],
    );
    await client.query(
      `UPDATE public.orders SET kitchen_status='sent', kitchen_sent_at=now() WHERE id=$1`,
      [orderId],
    );

    await client.query(`SET LOCAL ROLE service_role`);
    const rows = await q<{ items: Array<{ order_item_id: string; quantity: number }> }>(
      `SELECT items FROM public.get_kitchen_queue(NULL, $1) WHERE order_id=$2`,
      [branchId, orderId],
    );
    await client.query(`RESET ROLE`);

    expect(rows.length).toBe(1);
    expect(rows[0].items).toHaveLength(1);
    expect(rows[0].items[0].order_item_id).toBe(itemId);
    expect(Number(rows[0].items[0].quantity)).toBe(1);
  });

  it('hides the order again once the new cycle is served', async () => {
    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SELECT public.set_kitchen_status($1, 'served')`, [orderId]);
    const rows = await q<{ order_id: string }>(
      `SELECT order_id FROM public.get_kitchen_queue(NULL, $1) WHERE order_id=$2`,
      [branchId, orderId],
    );
    await client.query(`RESET ROLE`);

    expect(rows).toHaveLength(0);

    const baseline = await q<{ served_quantity: string }>(
      `SELECT served_quantity::text
       FROM public.order_kitchen_served_quantities
       WHERE order_id=$1 AND order_item_id=$2`,
      [orderId, itemId],
    );
    expect(Number(baseline[0]?.served_quantity)).toBe(2);
  });
});
