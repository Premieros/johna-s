import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('dining table occupancy reconciliation', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('installs central orders and order-items triggers for occupancy reconciliation', async () => {
    const triggers = await client.query<{ name: string; table_name: string; definition: string }>(
      `SELECT t.tgname AS name,
              c.relname AS table_name,
              pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND t.tgname IN (
           'trg_reconcile_dining_table_occupancy',
           'trg_reconcile_dining_table_occupancy_from_item'
         )
         AND NOT t.tgisinternal
       ORDER BY t.tgname`,
    );

    expect(triggers.rows).toHaveLength(2);
    expect(triggers.rows.some((r) => r.table_name === 'orders' && r.definition.includes('private.reconcile_dining_table_occupancy_from_order()'))).toBe(true);
    expect(triggers.rows.some((r) => r.table_name === 'order_items' && r.definition.includes('private.reconcile_dining_table_occupancy_from_order_item()'))).toBe(true);
  });

  it('does not occupy for an empty order, occupies after first item, and frees after last item is removed', async () => {
    await client.query('BEGIN');
    try {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO public.branches(name, is_active)
         VALUES ($1, true)
         RETURNING id`,
        [`occupancy-empty-${Date.now()}`],
      );
      const branchId = branch.rows[0].id;
      const tables = await client.query<{ id: string; name: string }>(
        `SELECT id, name
         FROM public.dining_tables
         WHERE branch_id = $1
           AND name IN ('طاولة 01', 'طاولة 02', 'طاولة 03', 'طاولة 04')
         ORDER BY name`,
        [branchId],
      );
      expect(tables.rows).toHaveLength(4);
      const [table1, table2, table3, table4] = tables.rows;

      await client.query(`UPDATE public.dining_tables SET status='reserved' WHERE id=$1`, [table3.id]);
      await client.query(`UPDATE public.dining_tables SET status='closed' WHERE id=$1`, [table4.id]);

      const order = await client.query<{ id: string }>(
        `INSERT INTO public.orders(order_number, branch_id, order_type, status, table_id, subtotal, discount_amount, discount_type, tax_amount, total)
         VALUES ($1, $2, 'dine_in', 'open', $3, 0, 0, 'amount', 0, 0)
         RETURNING id`,
        [`OCC-${Date.now()}`, branchId, table1.id],
      );
      const orderId = order.rows[0].id;

      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table1.id])).rows[0].status).toBe('vacant');

      const item = await client.query<{ id: string }>(
        `INSERT INTO public.order_items(order_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
         VALUES ($1, 'piece', 1, 10, 0, 0, 10)
         RETURNING id`,
        [orderId],
      );
      const itemId = item.rows[0].id;

      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table1.id])).rows[0].status).toBe('occupied');

      await client.query(`UPDATE public.orders SET table_id=$1 WHERE id=$2`, [table2.id, orderId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table1.id])).rows[0].status).toBe('vacant');
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table2.id])).rows[0].status).toBe('occupied');

      await client.query(`UPDATE public.orders SET status='held' WHERE id=$1`, [orderId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table2.id])).rows[0].status).toBe('occupied');

      await client.query(`UPDATE public.order_items SET quantity=0 WHERE id=$1`, [itemId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table2.id])).rows[0].status).toBe('vacant');

      await client.query(`UPDATE public.order_items SET quantity=1 WHERE id=$1`, [itemId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table2.id])).rows[0].status).toBe('occupied');

      await client.query(`DELETE FROM public.order_items WHERE id=$1`, [itemId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table2.id])).rows[0].status).toBe('vacant');

      await client.query(`SELECT private.reconcile_dining_table_occupancy($1)`, [table3.id]);
      await client.query(`SELECT private.reconcile_dining_table_occupancy($1)`, [table4.id]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table3.id])).rows[0].status).toBe('reserved');
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [table4.id])).rows[0].status).toBe('closed');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('frees an occupied table when its final active order is cancelled or deleted', async () => {
    await client.query('BEGIN');
    try {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO public.branches(name, is_active)
         VALUES ($1, true)
         RETURNING id`,
        [`occupancy-close-${Date.now()}`],
      );
      const branchId = branch.rows[0].id;
      const table = await client.query<{ id: string }>(
        `SELECT id FROM public.dining_tables WHERE branch_id=$1 AND name='طاولة 01'`,
        [branchId],
      );
      const tableId = table.rows[0].id;

      const order = await client.query<{ id: string }>(
        `INSERT INTO public.orders(order_number, branch_id, order_type, status, table_id, subtotal, discount_amount, discount_type, tax_amount, total)
         VALUES ($1, $2, 'dine_in', 'open', $3, 10, 0, 'amount', 0, 10)
         RETURNING id`,
        [`OCC-CLOSE-${Date.now()}`, branchId, tableId],
      );
      const orderId = order.rows[0].id;
      await client.query(
        `INSERT INTO public.order_items(order_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
         VALUES ($1, 'piece', 1, 10, 0, 0, 10)`,
        [orderId],
      );
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [tableId])).rows[0].status).toBe('occupied');

      await client.query(`UPDATE public.orders SET status='cancelled' WHERE id=$1`, [orderId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [tableId])).rows[0].status).toBe('vacant');

      await client.query(`UPDATE public.orders SET status='open' WHERE id=$1`, [orderId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [tableId])).rows[0].status).toBe('occupied');

      await client.query(`DELETE FROM public.orders WHERE id=$1`, [orderId]);
      expect((await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id=$1`, [tableId])).rows[0].status).toBe('vacant');
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
