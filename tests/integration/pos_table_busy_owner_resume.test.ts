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

    await client.query(
      `INSERT INTO public.dining_tables(id, branch_id, name, capacity, status, is_active)
       VALUES ($1, $2, 'Resume Guard Table', 4, 'vacant', true)`,
      [tableA, ids.branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('returns the open order id only to its current operator', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const createdRows = await asUser(
      ids.users.cashier,
      `SELECT public.create_order(
        $1, 'dine_in', $2, NULL, 2, 'owner resume guard', '[]'::jsonb,
        0, 0, 'amount', 0, 0, NULL
      ) AS r`,
      [ids.branchA, tableA],
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
