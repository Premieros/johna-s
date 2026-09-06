import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type Rpc = { success?: boolean; error?: string; user_id?: string; dependency?: string; action?: string };

describe.skipIf(skip)('QA batch 1 — safe user deletion with dependencies', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const managerId = randomUUID();
  const managerRole = `qa_delete_manager_${randomUUID().slice(0,8)}`;
  const targetRole = `qa_delete_target_${randomUUID().slice(0,8)}`;

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches(id,name) VALUES($1,'Safe Delete Branch')`, [branchId]);
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES
         ($1,'مدير حذف','Delete manager','["users.manage"]'::jsonb,'global',true),
         ($2,'مستخدم','Delete target','[]'::jsonb,'global',true)`,
      [managerRole, targetRole],
    );
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES($1,$2,$3,'Delete Manager',$4,$5,true)`,
      [managerId, `${randomUUID()}@test.local`, `delm_${randomUUID().slice(0,8)}`, managerRole, branchId],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('blocks hard-delete for a user referenced by a shift and preserves history', async () => {
    const created = await asUser(managerId, async () => {
      const row = await client.query<{ r: Rpc }>(
        `SELECT public.create_user($1,$2,$3,$4,$5,$6,$7) AS r`,
        [`linked-${randomUUID()}@test.local`, '7744', 'Linked User', targetRole, branchId, true, `linked_${randomUUID().slice(0,8)}`],
      );
      return row.rows[0].r;
    });
    expect(created.success).toBe(true);
    const userId = String(created.user_id);

    const shift = await client.query<{ id: string }>(
      `INSERT INTO public.shifts(branch_id,cashier_id,status,closed_at,opening_amount,expected_amount,actual_amount,difference)
       VALUES($1,$2,'closed',now(),0,0,0,0) RETURNING id`,
      [branchId, userId],
    );
    const shiftId = shift.rows[0].id;

    const deletion = await asUser(managerId, async () => {
      const row = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [userId]);
      return row.rows[0].r;
    });
    expect(deletion).toMatchObject({
      success: false,
      error: 'USER_HAS_DEPENDENCIES',
      dependency: 'shifts',
      action: 'DISABLE_USER_INSTEAD',
    });

    const preserved = await client.query<{ app_count: string; auth_count: string; shift_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM public.users WHERE id=$1) AS app_count,
         (SELECT count(*)::text FROM auth.users WHERE id=$1) AS auth_count,
         (SELECT count(*)::text FROM public.shifts WHERE id=$2) AS shift_count`,
      [userId, shiftId],
    );
    expect(preserved.rows[0]).toEqual({ app_count: '1', auth_count: '1', shift_count: '1' });

    const disabled = await asUser(managerId, async () =>
      client.query(`UPDATE public.users SET is_active=false WHERE id=$1`, [userId]),
    );
    expect(disabled.rowCount).toBe(1);
    const status = await client.query<{ is_active: boolean }>(`SELECT is_active FROM public.users WHERE id=$1`, [userId]);
    expect(status.rows[0].is_active).toBe(false);
  });
});
