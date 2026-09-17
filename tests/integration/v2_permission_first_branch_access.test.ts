import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('V2 permission-first roles and branch access', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const branchC = randomUUID();
  const managerId = randomUUID();
  const targetId = randomUUID();
  const ownerId = randomUUID();
  const superAdminId = randomUUID();
  const managerRole = `v2_perm_manager_${randomUUID().slice(0, 8)}`;
  const targetRole = `v2_perm_target_${randomUUID().slice(0, 8)}`;
  const escalatedRole = `v2_perm_escalated_${randomUUID().slice(0, 8)}`;

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(userId: string, fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
    const savepoint = `v2_permission_error_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await expect(asUser(userId, fn)).rejects.toThrow(pattern);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'Permission A'), ($2, 'Permission B'), ($3, 'Permission C')`,
      [branchA, branchB, branchC],
    );

    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES
         ($1, 'مدير صلاحيات V2', 'V2 permission manager', '["users.view","users.manage","users.branches.manage","settings.manage","branches.manage","pos.view"]'::jsonb, 'global', true),
         ($2, 'مستخدم V2', 'V2 target', '["pos.view"]'::jsonb, 'global', true),
         ($3, 'دور أعلى V2', 'V2 escalated', '["accounts.manage"]'::jsonb, 'global', true)`,
      [managerRole, targetRole, escalatedRole],
    );

    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES
         ($1, $2, 'Permission Manager', $3, $4, true),
         ($5, $6, 'Permission Target', $7, $4, true),
         ($8, $9, 'Owner Label User', 'owner', $4, true),
         ($10, $11, 'Platform Admin', 'super_admin', $4, true)`,
      [
        managerId, `${randomUUID()}@test.local`, managerRole, branchA,
        targetId, `${randomUUID()}@test.local`, targetRole,
        ownerId, `${randomUUID()}@test.local`,
        superAdminId, `${randomUUID()}@test.local`,
      ],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.user_branch_access (user_id, branch_id)
       VALUES ($1, $2), ($3, $2)`,
      [managerId, branchB, targetId],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('uses explicit permissions for arbitrary role names', async () => {
    const result = await asUser(managerId, async () => {
      const allowed = await client.query<{ allowed: boolean }>(`SELECT public.can_permission('users.manage') AS allowed`);
      const denied = await client.query<{ allowed: boolean }>(`SELECT public.can_permission('accounts.manage') AS allowed`);
      return { allowed: allowed.rows[0].allowed, denied: denied.rows[0].allowed };
    });
    expect(result).toEqual({ allowed: true, denied: false });
  });

  it('does not treat owner as a platform permission bypass', async () => {
    const allowed = await asUser(ownerId, async () => {
      const result = await client.query<{ allowed: boolean }>(
        `SELECT public.can_permission('v2.permission.sentinel.never.granted') AS allowed`,
      );
      return result.rows[0].allowed;
    });
    expect(allowed).toBe(false);
  });

  it('allows only the primary and explicitly granted branches', async () => {
    const result = await asUser(managerId, async () => {
      const access = await client.query<{ a: boolean; b: boolean; c: boolean }>(
        `SELECT public.user_may_access_branch($1) AS a,
                public.user_may_access_branch($2) AS b,
                public.user_may_access_branch($3) AS c`,
        [branchA, branchB, branchC],
      );
      const visible = await client.query<{ id: string }>(
        `SELECT id FROM public.branches WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[branchA, branchB, branchC]],
      );
      return { access: access.rows[0], visible: visible.rows.map((row) => row.id).sort() };
    });

    expect(result.access).toEqual({ a: true, b: true, c: false });
    expect(result.visible).toEqual([branchA, branchB].sort());
  });

  it('lets users.branches.manage maintain branch grants only inside the caller scope', async () => {
    const success = await asUser(managerId, async () => {
      const result = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.set_user_branch_access($1, ARRAY[$2,$3]::uuid[]) AS r`,
        [targetId, branchA, branchB],
      );
      return result.rows[0].r;
    });
    expect(success.success).toBe(true);

    const denied = await asUser(managerId, async () => {
      const result = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.set_user_branch_access($1, ARRAY[$2,$3]::uuid[]) AS r`,
        [targetId, branchA, branchC],
      );
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'BRANCH_ACCESS_DENIED' });
  });

  it('prevents a role editor from granting a permission they do not own', async () => {
    await expectDbError(managerId, async () => {
      await client.query(
        `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
         VALUES ($1, 'تصعيد ممنوع', 'Denied escalation', '["accounts.manage"]'::jsonb, 'global', true)`,
        [`v2_denied_${randomUUID().slice(0, 8)}`],
      );
    }, /cannot grant permission accounts\.manage|PERMISSION_DENIED/i);
  });

  it('prevents assigning a role that contains permissions the caller lacks', async () => {
    await expectDbError(managerId, async () => {
      await client.query(`UPDATE public.users SET role = $1 WHERE id = $2`, [escalatedRole, targetId]);
    }, /cannot assign role containing permission accounts\.manage|PERMISSION_DENIED/i);
  });

  it('keeps Super Admin as the only platform-wide exception', async () => {
    const result = await asUser(superAdminId, async () => {
      const permission = await client.query<{ allowed: boolean }>(
        `SELECT public.can_permission('v2.permission.sentinel.never.granted') AS allowed`,
      );
      const branch = await client.query<{ allowed: boolean }>(
        `SELECT public.user_may_access_branch($1) AS allowed`,
        [branchC],
      );
      return { permission: permission.rows[0].allowed, branch: branch.rows[0].allowed };
    });
    expect(result).toEqual({ permission: true, branch: true });
  });
});
