import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type Rpc = { success?: boolean; error?: string; user_id?: string };

describe.skipIf(skip)('QA batch 1 — Permission-First user management lifecycle', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const permissionManagerId = randomUUID();
  const labelOnlyManagerId = randomUUID();
  const superAdminId = randomUUID();
  const outOfScopeTargetId = randomUUID();
  const managerRole = `qa_users_manager_${randomUUID().slice(0, 8)}`;
  const targetRole = `qa_users_target_${randomUUID().slice(0, 8)}`;

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

  async function callCreate(userId: string, branchId: string, email: string): Promise<Rpc> {
    return asUser(userId, async () => {
      const result = await client.query<{ r: Rpc }>(
        `SELECT public.create_user($1,$2,$3,$4,$5,$6,$7) AS r`,
        [email, '8246', 'QA Managed User', targetRole, branchId, true, `qa_${randomUUID().slice(0, 8)}`],
      );
      return result.rows[0].r;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id, name) VALUES ($1,'QA Users Branch A'),($2,'QA Users Branch B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active)
       VALUES
         ($1,'مدير مستخدمين QA','QA user manager','["users.manage"]'::jsonb,'global',true),
         ($2,'مستخدم فارغ QA','QA target','[]'::jsonb,'global',true)`,
      [managerRole, targetRole],
    );

    // Prove that the legacy Branch Manager label by itself grants nothing.
    await client.query(`UPDATE public.roles SET permissions='[]'::jsonb WHERE role='branch_manager'`);

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES
         ($1,$2,$3,'Permission Manager',$4,$5,true),
         ($6,$7,$8,'Label Only Manager','branch_manager',$5,true),
         ($9,$10,$11,'Super Admin','super_admin',$5,true),
         ($12,$13,$14,'Out of Scope Target',$15,$16,true)`,
      [
        permissionManagerId, `${randomUUID()}@test.local`, `pm_${randomUUID().slice(0, 8)}`, managerRole, branchA,
        labelOnlyManagerId, `${randomUUID()}@test.local`, `lm_${randomUUID().slice(0, 8)}`,
        superAdminId, `${randomUUID()}@test.local`, `sa_${randomUUID().slice(0, 8)}`,
        outOfScopeTargetId, `${randomUUID()}@test.local`, `oo_${randomUUID().slice(0, 8)}`, targetRole, branchB,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens all user mutation RPC search paths', async () => {
    const rows = await client.query<{ proname: string; cfg: string[] | null }>(
      `SELECT proname, proconfig AS cfg
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND proname IN ('create_user','delete_user','update_user_password')`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows.rows) {
      expect(row.cfg).toContain('search_path=public, pg_temp');
    }
  });

  it('does not grant create-user authority from branch_manager label alone', async () => {
    const result = await callCreate(labelOnlyManagerId, branchA, `label-${randomUUID()}@test.local`);
    expect(result).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  it('allows an arbitrary role with users.manage to create a same-branch user', async () => {
    const result = await callCreate(permissionManagerId, branchA, `managed-${randomUUID()}@test.local`);
    expect(result.success).toBe(true);
    expect(result.user_id).toBeTruthy();

    const stored = await client.query<{ role: string; branch_id: string; auth_count: string }>(
      `SELECT u.role,u.branch_id,
              (SELECT count(*)::text FROM auth.users au WHERE au.id=u.id) AS auth_count
       FROM public.users u WHERE u.id=$1`,
      [result.user_id],
    );
    expect(stored.rows[0]).toMatchObject({ role: targetRole, branch_id: branchA, auth_count: '1' });
  });

  it('blocks cross-branch create even when users.manage is present', async () => {
    const result = await callCreate(permissionManagerId, branchB, `cross-${randomUUID()}@test.local`);
    expect(result).toMatchObject({ success: false, error: 'BRANCH_ACCESS_DENIED' });
  });

  it('uses users.manage, not the role label, for password updates', async () => {
    const created = await callCreate(permissionManagerId, branchA, `password-${randomUUID()}@test.local`);
    expect(created.success).toBe(true);
    const userId = String(created.user_id);

    const before = await client.query<{ encrypted_password: string }>(
      `SELECT encrypted_password FROM auth.users WHERE id=$1`, [userId],
    );

    const denied = await asUser(labelOnlyManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [userId, '9371']);
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const allowed = await asUser(permissionManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [userId, '9371']);
      return result.rows[0].r;
    });
    expect(allowed.success).toBe(true);

    const after = await client.query<{ encrypted_password: string }>(
      `SELECT encrypted_password FROM auth.users WHERE id=$1`, [userId],
    );
    expect(after.rows[0].encrypted_password).not.toBe(before.rows[0].encrypted_password);
  });

  it('blocks out-of-scope password/delete operations', async () => {
    const password = await asUser(permissionManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [outOfScopeTargetId, '1122']);
      return result.rows[0].r;
    });
    expect(password).toMatchObject({ success: false, error: 'TARGET_OUT_OF_SCOPE' });

    const deleted = await asUser(permissionManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [outOfScopeTargetId]);
      return result.rows[0].r;
    });
    expect(deleted).toMatchObject({ success: false, error: 'TARGET_OUT_OF_SCOPE' });
  });

  it('allows users.manage to delete a same-branch unreferenced user from app + auth', async () => {
    const created = await callCreate(permissionManagerId, branchA, `delete-${randomUUID()}@test.local`);
    expect(created.success).toBe(true);
    const userId = String(created.user_id);

    const denied = await asUser(labelOnlyManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [userId]);
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const allowed = await asUser(permissionManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [userId]);
      return result.rows[0].r;
    });
    expect(allowed.success).toBe(true);

    const counts = await client.query<{ app_count: string; auth_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM public.users WHERE id=$1) AS app_count,
         (SELECT count(*)::text FROM auth.users WHERE id=$1) AS auth_count`,
      [userId],
    );
    expect(counts.rows[0]).toEqual({ app_count: '0', auth_count: '0' });
  });

  it('keeps Super Admin protected from non-admin mutation', async () => {
    const password = await asUser(permissionManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [superAdminId, '1122']);
      return result.rows[0].r;
    });
    expect(password).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const deleted = await asUser(permissionManagerId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [superAdminId]);
      return result.rows[0].r;
    });
    expect(deleted).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });
});
