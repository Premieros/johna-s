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
  const createOnlyId = randomUUID();
  const manageOnlyId = randomUUID();
  const branchOnlyId = randomUUID();
  const labelOnlyManagerId = randomUUID();
  const superAdminId = randomUUID();
  const outOfScopeTargetId = randomUUID();
  const createRole = `qa_users_create_${randomUUID().slice(0, 8)}`;
  const manageRole = `qa_users_manage_${randomUUID().slice(0, 8)}`;
  const branchRole = `qa_users_branches_${randomUUID().slice(0, 8)}`;
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
         ($1,'منشئ مستخدمين QA','QA user creator','["users.create"]'::jsonb,'global',true),
         ($2,'مدير مستخدمين QA','QA user manager','["users.manage"]'::jsonb,'global',true),
         ($3,'مدير فروع مستخدم QA','QA branch access manager','["users.branches.manage"]'::jsonb,'global',true),
         ($4,'مستخدم فارغ QA','QA target','[]'::jsonb,'global',true)`,
      [createRole, manageRole, branchRole, targetRole],
    );

    // Prove that the legacy Branch Manager label by itself grants nothing.
    await client.query(`UPDATE public.roles SET permissions='[]'::jsonb WHERE role='branch_manager'`);

    // Keep fixture bypass local to this DB session/transaction. ALTER TABLE ...
    // DISABLE TRIGGER takes a table-level DDL lock and can deadlock with other
    // integration suites running against public.users in parallel.
    await client.query(`SET LOCAL session_replication_role = 'replica'`);
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES
         ($1,$2,$3,'Create Only',$4,$5,true),
         ($6,$7,$8,'Manage Only',$9,$5,true),
         ($10,$11,$12,'Branch Access Only',$13,$5,true),
         ($14,$15,$16,'Label Only Manager','branch_manager',$5,true),
         ($17,$18,$19,'Super Admin','super_admin',$5,true),
         ($20,$21,$22,'Out of Scope Target',$23,$24,true)`,
      [
        createOnlyId, `${randomUUID()}@test.local`, `cu_${randomUUID().slice(0, 8)}`, createRole, branchA,
        manageOnlyId, `${randomUUID()}@test.local`, `mu_${randomUUID().slice(0, 8)}`, manageRole,
        branchOnlyId, `${randomUUID()}@test.local`, `bu_${randomUUID().slice(0, 8)}`, branchRole,
        labelOnlyManagerId, `${randomUUID()}@test.local`, `lm_${randomUUID().slice(0, 8)}`,
        superAdminId, `${randomUUID()}@test.local`, `sa_${randomUUID().slice(0, 8)}`,
        outOfScopeTargetId, `${randomUUID()}@test.local`, `oo_${randomUUID().slice(0, 8)}`, targetRole, branchB,
      ],
    );
    await client.query(`SET LOCAL session_replication_role = 'origin'`);
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
       WHERE n.nspname='public' AND proname IN ('create_user','delete_user','update_user_password','set_user_branch_access')`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows.rows) {
      expect(row.cfg).toContain('search_path=public, pg_temp');
    }
  });

  it('does not grant create-user authority from branch_manager label alone', async () => {
    const result = await callCreate(labelOnlyManagerId, branchA, `label-${randomUUID()}@test.local`);
    expect(result).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  it('allows users.create to create a same-branch user without users.manage', async () => {
    const result = await callCreate(createOnlyId, branchA, `created-${randomUUID()}@test.local`);
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

  it('does not let users.manage substitute for users.create', async () => {
    const result = await callCreate(manageOnlyId, branchA, `manage-create-${randomUUID()}@test.local`);
    expect(result).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  it('blocks cross-branch create even when users.create is present', async () => {
    const result = await callCreate(createOnlyId, branchB, `cross-${randomUUID()}@test.local`);
    expect(result).toMatchObject({ success: false, error: 'BRANCH_ACCESS_DENIED' });
  });

  it('keeps password updates under users.manage', async () => {
    const created = await callCreate(createOnlyId, branchA, `password-${randomUUID()}@test.local`);
    expect(created.success).toBe(true);
    const userId = String(created.user_id);

    const before = await client.query<{ encrypted_password: string }>(
      `SELECT encrypted_password FROM auth.users WHERE id=$1`, [userId],
    );

    const denied = await asUser(createOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [userId, '9371']);
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const allowed = await asUser(manageOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [userId, '9371']);
      return result.rows[0].r;
    });
    expect(allowed.success).toBe(true);

    const after = await client.query<{ encrypted_password: string }>(
      `SELECT encrypted_password FROM auth.users WHERE id=$1`, [userId],
    );
    expect(after.rows[0].encrypted_password).not.toBe(before.rows[0].encrypted_password);
  });

  it('separates users.branches.manage from users.manage', async () => {
    const created = await callCreate(createOnlyId, branchA, `branches-${randomUUID()}@test.local`);
    expect(created.success).toBe(true);
    const userId = String(created.user_id);

    const denied = await asUser(manageOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(
        `SELECT public.set_user_branch_access($1,$2::uuid[]) AS r`,
        [userId, [branchA]],
      );
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const allowed = await asUser(branchOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(
        `SELECT public.set_user_branch_access($1,$2::uuid[]) AS r`,
        [userId, [branchA]],
      );
      return result.rows[0].r;
    });
    expect(allowed.success).toBe(true);

    const crossBranch = await asUser(branchOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(
        `SELECT public.set_user_branch_access($1,$2::uuid[]) AS r`,
        [userId, [branchA, branchB]],
      );
      return result.rows[0].r;
    });
    expect(crossBranch).toMatchObject({ success: false, error: 'BRANCH_ACCESS_DENIED' });
  });

  it('blocks out-of-scope password/delete operations', async () => {
    const password = await asUser(manageOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [outOfScopeTargetId, '1122']);
      return result.rows[0].r;
    });
    expect(password).toMatchObject({ success: false, error: 'TARGET_OUT_OF_SCOPE' });

    const deleted = await asUser(manageOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [outOfScopeTargetId]);
      return result.rows[0].r;
    });
    expect(deleted).toMatchObject({ success: false, error: 'TARGET_OUT_OF_SCOPE' });
  });

  it('allows users.manage to delete a same-branch unreferenced user from app + auth', async () => {
    const created = await callCreate(createOnlyId, branchA, `delete-${randomUUID()}@test.local`);
    expect(created.success).toBe(true);
    const userId = String(created.user_id);

    const denied = await asUser(createOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [userId]);
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const allowed = await asUser(manageOnlyId, async () => {
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
    const password = await asUser(manageOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.update_user_password($1,$2) AS r`, [superAdminId, '1122']);
      return result.rows[0].r;
    });
    expect(password).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const deleted = await asUser(manageOnlyId, async () => {
      const result = await client.query<{ r: Rpc }>(`SELECT public.delete_user($1) AS r`, [superAdminId]);
      return result.rows[0].r;
    });
    expect(deleted).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });
});
