import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type ResolverResult = {
  success?: boolean;
  error?: string;
  resumable?: boolean;
  order_id?: string;
};

describe.skipIf(skip)('TABLE_BUSY owner-only resume resolver', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const tableA = randomUUID();
  const productId = randomUUID();
  const unitId = randomUUID();

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const rpc = async (userId: string, tableId: string): Promise<ResolverResult> => {
    const rows = await asUser(
      userId,
      `SELECT public.resolve_my_active_table_order($1) AS r`,
      [tableId],
    );
    return (rows[0]?.r || {}) as ResolverResult;
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    await client.query(`
      UPDATE public.roles
      SET permissions = permissions || '["pos.view","pos.order.create"]'::jsonb
      WHERE role IN ('cashier', 'branch_manager')
    `);

    // Reuse the same valid ready-product fixture pattern as the protected
    // POS ownership release gate. This suite tests resolver privacy, not the
    // create_order empty-cart contract.
    await client.query(
      `UPDATE public.warehouses
          SET is_default = (id = $1::uuid)
        WHERE branch_id = $2::uuid`,
      [ids.whA, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.dining_tables(id, branch_id, name, capacity, status, is_active)
       VALUES ($1, $2, 'Resume Guard Table', 4, 'vacant', true)`,
      [tableA, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.products(id, name, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, 'Resume Guard Product', $2, 10, 20, true)`,
      [productId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_units(id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'Resume Guard Ready Unit', 'ready', $3, 10, 20, true)`,
      [unitId, `RES-${randomUUID()}`, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.product_unit_links(product_id, unit_id, quantity)
       VALUES ($1, $2, 1)`,
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

  it('returns the open order id only to its current operator', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const items = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 20,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 20,
    }]);

    const createdRows = await asUser(
      ids.users.cashier,
      `SELECT public.create_order(
        $1, 'dine_in', $2, NULL, 2, 'owner resume guard', $3::jsonb,
        20, 0, 'amount', 0, 20, NULL
      ) AS r`,
      [ids.branchA, tableA, items],
    );
    const created = (createdRows[0]?.r || {}) as ResolverResult;
    expect(created.success).toBe(true);
    expect(created.order_id).toBeTruthy();
    const orderId = String(created.order_id);

    const owner = await rpc(ids.users.cashier, tableA);
    expect(owner.success).toBe(true);
    expect(owner.resumable).toBe(true);
    expect(owner.order_id).toBe(orderId);

    const sameBranchPeer = await rpc(ids.users.branch_manager, tableA);
    expect(sameBranchPeer.success).toBe(false);
    expect(sameBranchPeer.error).toBe('TABLE_BUSY');
    expect(sameBranchPeer.resumable).toBe(false);
    expect(sameBranchPeer.order_id).toBeUndefined();

    const crossBranchUser = await rpc(ids.users.cashier_b, tableA);
    expect(crossBranchUser.success).toBe(false);
    expect(crossBranchUser.error).toBe('TABLE_NOT_FOUND');
    expect(crossBranchUser.order_id).toBeUndefined();

    // Even Super Admin does not receive another operator's order id through
    // this narrowly-scoped helper. Explicit transfer/admin flows remain separate.
    const superAdmin = await rpc(ids.users.super_admin, tableA);
    expect(superAdmin.success).toBe(false);
    expect(superAdmin.error).toBe('TABLE_BUSY');
    expect(superAdmin.order_id).toBeUndefined();
  });
});
