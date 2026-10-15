import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

// Regression tests for migration 046 (audit C2 / H2 / H4 / M4):
//
//   C2  update_order rewrites an existing order instead of duplicating it.
//   H2  create_order rejects a second order on an occupied table;
//       set_table_status rejects freeing a table with open/held orders.
//   M4  deleting a table with open/held orders is blocked.
//   H4  moving an order to another table frees the old table.
//
// Runs inside a single BEGIN..ROLLBACK transaction — safe against the live DB.
//
//   Run:  npm run test:integration
//   Skip: when no URL is configured

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('update_order + occupancy guards (046 C2/H2/M4)', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const whId = randomUUID();
  const prodId = randomUUID();
  const tableA = randomUUID();
  const tableB = randomUUID();
  const cashierId = randomUUID();

  const makeTable = async (): Promise<string> => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`,
      [id, `T-${id.slice(0, 4)}`, branchId],
    );
    return id;
  };

  const itemJson = (qty: number, price = 100) =>
    JSON.stringify([
      { product_id: prodId, unit_name: 'piece', quantity: qty, unit_price: price, discount_amount: 0, bonus_quantity: 0, total: qty * price },
    ]);

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function createOrder(tableId: string | null, orderType = 'dine_in') {
    return asUser(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string; order_id?: string; detail?: string } }>(
        `SELECT public.create_order($1, $2, $3, NULL, 2, NULL, $4::jsonb, 100, 0, 'amount', 0, 100, $5) AS r`,
        [branchId, orderType, tableId, itemJson(1), cashierId],
      );
      return res.rows[0].r;
    });
  }

  async function updateOrder(orderId: string, opts: { tableId?: string | null; status?: string; orderType?: string } = {}) {
    return asUser(async () => {
      const res = await client.query<{ r: { success: boolean; error?: string; detail?: string } }>(
        `SELECT public.update_order($1, $2, $3, NULL, 3, NULL, $4::jsonb, 200, 0, 'amount', 0, 200, $5) AS r`,
        [orderId, opts.orderType ?? 'dine_in', opts.tableId ?? null, itemJson(2, 100), opts.status ?? 'held'],
      );
      return res.rows[0].r;
    });
  }

  async function tableStatus(tableId: string): Promise<string> {
    const r = await client.query<{ status: string }>(`SELECT status FROM public.dining_tables WHERE id = $1`, [tableId]);
    return r.rows[0].status;
  }

  async function orderCount(): Promise<number> {
    const r = await client.query<{ c: number }>(`SELECT count(*)::int AS c FROM public.orders WHERE branch_id = $1`, [branchId]);
    return r.rows[0].c;
  }

  const orgId = randomUUID();
  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, '046 Org', `046-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchId, '046 C2 Branch', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, '046 WH', branchId]);
    await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`, [prodId, '046 Product', branchId]);
    await client.query(`INSERT INTO public.inventory_batches (product_id, warehouse_id, branch_id, quantity, unit_cost, source_type) VALUES ($1, $2, $3, 10, 50, 'opening')`, [prodId, whId, branchId]);
    await client.query(`INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`, [tableA, 'T-A', branchId]);
    await client.query(`INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`, [tableB, 'T-B', branchId]);
    await client.query(`INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, 'cashier', $4, true)`, [cashierId, `c2-${randomUUID()}@test.local`, 'Cashier', branchId]);
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'member', true)`, [orgId, cashierId]);
    await client.query(`INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ($1, $2, 0, 'open')`, [branchId, cashierId]);
    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('update_order re-holds the same order without duplicating it (C2)', async () => {
    const t = await makeTable();
    const created = await createOrder(t);
    expect(created.success).toBe(true);
    const orderId = created.order_id!;
    expect(await orderCount()).toBe(1);
    expect(await tableStatus(t)).toBe('occupied');

    const updated = await updateOrder(orderId, { tableId: t, status: 'held' });
    expect(updated.success).toBe(true);
    if (!updated.success) throw new Error(JSON.stringify(updated));

    // Still exactly one order.
    expect(await orderCount()).toBe(1);

    // Items were replaced (2 units instead of 1).
    const items = await client.query(
      `SELECT quantity::text AS q FROM public.order_items WHERE order_id = $1`,
      [orderId],
    );
    expect(items.rows).toHaveLength(1);
    expect(Number(items.rows[0].q)).toBe(2);

    const order = await client.query(`SELECT status, guest_count FROM public.orders WHERE id = $1`, [orderId]);
    expect(order.rows[0].status).toBe('held');
    expect(Number(order.rows[0].guest_count)).toBe(3);
    expect(await tableStatus(t)).toBe('occupied');
  });

  it('update_order rejects a completed order (ORDER_NOT_EDITABLE)', async () => {
    const t = await makeTable();
    const created = await createOrder(t);
    await client.query(`UPDATE public.orders SET status = 'completed' WHERE id = $1`, [created.order_id]);
    const r = await updateOrder(created.order_id!, { tableId: null });
    expect(r.success).toBe(false);
    expect(r.error).toBe('ORDER_NOT_EDITABLE');
  });

  it('create_order rejects a second order on an occupied table (H2 TABLE_BUSY)', async () => {
    const t = await makeTable();
    const created = await createOrder(t);
    expect(created.success).toBe(true);

    const second = await createOrder(t);
    expect(second.success).toBe(false);
    expect(second.error).toBe('TABLE_BUSY');
  });

  it('set_table_status rejects freeing a table with an open order (H2)', async () => {
    const t = await makeTable();
    await createOrder(t);

    const res = await asUser(async () =>
      client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.set_table_status($1, 'vacant') AS r`,
        [t],
      ),
    );
    expect(res.rows[0].r.success).toBe(false);
    expect(res.rows[0].r.error).toBe('TABLE_HAS_OPEN_ORDERS');
    expect(await tableStatus(t)).toBe('occupied');
  });

  it('deleting a table with an open order is blocked (M4)', async () => {
    const t = await makeTable();
    await createOrder(t);

    await client.query('SAVEPOINT m4_delete');
    let error: string | undefined;
    try {
      await client.query(`DELETE FROM public.dining_tables WHERE id = $1`, [t]);
    } catch (e: unknown) {
      error = (e as Error).message;
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT m4_delete').catch(() => {});
      await client.query('RELEASE SAVEPOINT m4_delete').catch(() => {});
    }
    expect(error).toBeTruthy();
    expect(await tableStatus(t)).toBe('occupied');
  });

  it('moving an order to another table frees the old table (H4)', async () => {
    const t1 = await makeTable();
    const t2 = await makeTable();
    const created = await createOrder(t1);
    expect(created.success).toBe(true);

    const moved = await updateOrder(created.order_id!, { tableId: t2, status: 'held' });
    expect(moved.success).toBe(true);

    expect(await tableStatus(t1)).toBe('vacant');
    expect(await tableStatus(t2)).toBe('occupied');

    const order = await client.query(`SELECT table_id FROM public.orders WHERE id = $1`, [created.order_id]);
    expect(order.rows[0].table_id).toBe(t2);
  });

  it('ordinary update_order preserves a live table binding when table_id is omitted', async () => {
    const t = await makeTable();
    const created = await createOrder(t);
    expect(created.success).toBe(true);

    const saved = await updateOrder(created.order_id!, { tableId: null, status: 'held' });
    expect(saved.success).toBe(true);
    expect(await tableStatus(t)).toBe('occupied');

    const order = await client.query(`SELECT table_id, status, order_type FROM public.orders WHERE id = $1`, [created.order_id]);
    expect(order.rows[0].table_id).toBe(t);
    expect(order.rows[0].status).toBe('held');
    expect(order.rows[0].order_type).toBe('dine_in');
  });

  it('ordinary update_order cannot convert a table-bound order to takeaway', async () => {
    const t = await makeTable();
    const created = await createOrder(t);
    expect(created.success).toBe(true);

    const changed = await updateOrder(created.order_id!, { tableId: t, status: 'held', orderType: 'takeaway' });
    expect(changed.success).toBe(false);
    expect(changed.error).toBe('TABLE_ORDER_TYPE_MISMATCH');
    expect(await tableStatus(t)).toBe('occupied');
  });

  it('matches duplicate lines once per call and preserves original results after removing temporary DDL', async () => {
    const created = await createOrder(null, 'takeaway');
    expect(created.success).toBe(true);
    const orderId = created.order_id!;
    await client.query(`INSERT INTO public.order_items(order_id,product_id,unit_name,quantity,unit_price,total)
      VALUES($1,$2,'piece',1,100,100)`, [orderId,prodId]);
    const payload = JSON.stringify([2,3].map(quantity => ({
      product_id: prodId, unit_name: 'piece', quantity, unit_price: 100,
      discount_amount: 0, bonus_quantity: 0, total: quantity * 100,
    })));
    const run = async () => {
      const result = await asUser(() => client.query(
        "SELECT public.update_order($1,'takeaway',NULL,NULL,1,NULL,$2::jsonb,500,0,'amount',0,500,'held') r", [orderId,payload],
      ));
      expect(result.rows[0].r.success).toBe(true);
      const rows = (await client.query('SELECT id,quantity,total FROM public.order_items WHERE order_id=$1 ORDER BY id', [orderId])).rows;
      expect(rows).toHaveLength(2);
      expect(rows.map(row => Number(row.quantity)).sort()).toEqual([2,3]);
      return { result: result.rows[0].r, rows };
    };
    const optimized = await run();
    expect(await run()).toEqual(optimized); // empty matching set on every invocation
    await client.query('SAVEPOINT original_update_order');
    try {
      await client.query(readFileSync('scripts/rollback/operations_stability_original_functions_20261015.sql', 'utf8'));
      expect(await run()).toEqual(optimized);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT original_update_order');
      await client.query('RELEASE SAVEPOINT original_update_order');
    }
    expect(await run()).toEqual(optimized);
  });

  it('explicit detach_order remains the supported way to free a table-bound order', async () => {
    const t = await makeTable();
    const created = await createOrder(t);
    expect(created.success).toBe(true);

    const detached = await asUser(async () =>
      client.query<{ r: { success: boolean; error?: string } }>(
        `SELECT public.detach_order($1) AS r`,
        [created.order_id],
      ),
    );
    expect(detached.rows[0].r.success).toBe(true);
    expect(await tableStatus(t)).toBe('vacant');

    const order = await client.query(`SELECT table_id, status FROM public.orders WHERE id = $1`, [created.order_id]);
    expect(order.rows[0].table_id).toBeNull();
    expect(order.rows[0].status).toBe('open');
  });
});
