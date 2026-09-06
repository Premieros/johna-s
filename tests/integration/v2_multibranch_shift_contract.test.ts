import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  open?: boolean;
  shared?: boolean;
  already_open?: boolean;
  shift_id?: string;
  branch_id?: string;
  shift?: { id: string; branch_id: string; cashier_id: string };
};

describe.skipIf(skip)('V2 multi-branch shared shift contract', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const branchC = randomUUID();
  const userId = randomUUID();
  const secondCashierId = randomUUID();
  const role = `v2_shift_${randomUUID().slice(0, 8)}`;
  let shiftId = '';

  async function asUser<T>(id: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [id]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  const rpc = async (sql: string, params: unknown[] = []): Promise<RpcResult> => {
    const result = await client.query<{ r: RpcResult }>(sql, params);
    return result.rows[0].r;
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'V2 Shift A'), ($2, 'V2 Shift B'), ($3, 'V2 Shift C')`,
      [branchA, branchB, branchC],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES ($1, 'V2 shift user', 'V2 shift user', '["pos.view","shifts.view","shifts.open"]'::jsonb, 'global', true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES
         ($1, $2, 'V2 Multi Branch User', $3, $4, true),
         ($5, $6, 'V2 Branch B Cashier', $3, $7, true)`,
      [
        userId,
        `${randomUUID()}@test.local`,
        role,
        branchA,
        secondCashierId,
        `${randomUUID()}@test.local`,
        branchB,
      ],
    );
    await client.query(
      `INSERT INTO public.user_branch_access (user_id, branch_id) VALUES ($1, $2)`,
      [userId, branchB],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('opens one shared shift in an explicitly authorized secondary branch', async () => {
    const opened = await asUser(userId, () => rpc(
      `SELECT public.open_shift($1, $2, $3) AS r`,
      [branchB, 100, 'secondary branch shift'],
    ));
    expect(opened).toMatchObject({ success: true, branch_id: branchB, shared: true, already_open: false });
    expect(opened.shift_id).toBeTruthy();
    shiftId = opened.shift_id || '';
  });

  it('returns the active shift only for the selected branch', async () => {
    const activeB = await asUser(userId, () => rpc(`SELECT public.get_active_shift($1) AS r`, [branchB]));
    expect(activeB).toMatchObject({ success: true, open: true, shared: true });
    expect(activeB.shift).toMatchObject({ id: shiftId, branch_id: branchB, cashier_id: userId });

    const activeA = await asUser(userId, () => rpc(`SELECT public.get_active_shift($1) AS r`, [branchA]));
    expect(activeA).toMatchObject({ success: false, open: false });
  });

  it('lets another cashier in the same branch use the exact same open shift', async () => {
    const active = await asUser(secondCashierId, () => rpc(`SELECT public.get_active_shift($1) AS r`, [branchB]));
    expect(active).toMatchObject({ success: true, open: true, shared: true });
    expect(active.shift).toMatchObject({ id: shiftId, branch_id: branchB, cashier_id: userId });

    const joined = await asUser(secondCashierId, () => rpc(
      `SELECT public.open_shift($1, $2, NULL) AS r`,
      [branchB, 0],
    ));
    expect(joined).toMatchObject({
      success: true,
      shift_id: shiftId,
      branch_id: branchB,
      shared: true,
      already_open: true,
    });
  });

  it('keeps shifts branch-scoped so an authorized user can open a separate branch shift', async () => {
    const secondBranch = await asUser(userId, () => rpc(
      `SELECT public.open_shift($1, $2, NULL) AS r`,
      [branchA, 0],
    ));
    expect(secondBranch).toMatchObject({ success: true, branch_id: branchA, shared: true, already_open: false });
    expect(secondBranch.shift_id).toBeTruthy();
    expect(secondBranch.shift_id).not.toBe(shiftId);
  });

  it('returns the existing shift when the same branch is opened again', async () => {
    const second = await asUser(userId, () => rpc(
      `SELECT public.open_shift($1, $2, NULL) AS r`,
      [branchB, 0],
    ));
    expect(second).toMatchObject({
      success: true,
      shift_id: shiftId,
      branch_id: branchB,
      shared: true,
      already_open: true,
    });
  });

  it('rejects a branch the user has not been granted', async () => {
    const denied = await asUser(userId, () => rpc(
      `SELECT public.open_shift($1, $2, NULL) AS r`,
      [branchC, 0],
    ));
    expect(denied).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });

  it('does not let the shift opener close without shifts.close', async () => {
    const denied = await asUser(userId, () => rpc(
      `SELECT public.close_shift($1, $2, $3) AS r`,
      [shiftId, 100, 'no close permission'],
    ));
    expect(denied).toMatchObject({ success: false, error: 'SHIFT_CLOSE_DENIED' });
  });

  it('closes the shared branch shift after shifts.close is explicitly granted', async () => {
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["shifts.close"]'::jsonb
       WHERE role = $1`,
      [role],
    );

    const closed = await asUser(userId, () => rpc(
      `SELECT public.close_shift($1, $2, $3) AS r`,
      [shiftId, 100, 'authorized close'],
    ));
    expect(closed.success).toBe(true);
    expect(closed.shift_id).toBe(shiftId);
  });
});