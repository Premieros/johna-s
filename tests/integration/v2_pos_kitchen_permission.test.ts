import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = { success?: boolean; error?: string; items_sent?: number; all_sent?: boolean };

describe.skipIf(skip)('V2 POS kitchen permission contract', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userId = randomUUID();
  const orderA = randomUUID();
  const orderB = randomUUID();
  const role = `v2_order_only_${randomUUID().slice(0, 8)}`;

  async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  const send = async (orderId: string): Promise<RpcResult> => {
    const result = await client.query<{ r: RpcResult }>(`SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    return result.rows[0].r;
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id, name) VALUES ($1, 'V2 POS A'), ($2, 'V2 POS B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active, is_default)
       VALUES ($1, 'V2 POS A Warehouse', $2, true, true),
              ($3, 'V2 POS B Warehouse', $4, true, true)`,
      [randomUUID(), branchA, randomUUID(), branchB],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES ($1, 'V2 order only', 'V2 order only', '["pos.view","pos.order.create","pos.order.edit"]'::jsonb, 'global', true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'V2 Order User', $3, $4, true)`,
      [userId, `${randomUUID()}@test.local`, role, branchA],
    );
    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, status, kitchen_status, station, cashier_id)
       VALUES ($1, 'V2-KITCHEN-A', $2, 'open', 'pending', 'main', $5),
              ($3, 'V2-KITCHEN-B', $4, 'open', 'pending', 'main', NULL)`,
      [orderA, branchA, orderB, branchB, userId],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('does not treat order permissions as kitchen-send permission', async () => {
    const denied = await asUser(userId, () => send(orderA));
    expect(denied).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  it('allows kitchen send only after pos.send_kitchen is granted', async () => {
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["pos.send_kitchen"]'::jsonb
       WHERE role = $1`,
      [role],
    );

    const allowed = await asUser(userId, () => send(orderA));
    expect(allowed.success).toBe(true);
    expect(allowed.error).toBeUndefined();
  });

  it('keeps branch isolation even with kitchen-send permission', async () => {
    const denied = await asUser(userId, () => send(orderB));
    expect(denied).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });
});