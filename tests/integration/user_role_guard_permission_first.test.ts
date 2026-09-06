import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('QA batch 1 — direct user mutation guard', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const managerId = randomUUID();
  const labelOnlyId = randomUUID();
  const targetId = randomUUID();
  const selfUserId = randomUUID();
  const managerRole = `qa_direct_manager_${randomUUID().slice(0, 8)}`;
  const basicRole = `qa_direct_basic_${randomUUID().slice(0, 8)}`;
  const elevatedRole = `qa_direct_elevated_${randomUUID().slice(0, 8)}`;

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

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'Guard A'),($2,'Guard B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES
         ($1,'مدير مباشر','Direct manager','["users.manage"]'::jsonb,'global',true),
         ($2,'أساسي','Basic','[]'::jsonb,'global',true),
         ($3,'مرتفع','Elevated','["accounts.manage"]'::jsonb,'global',true)`,
      [managerRole, basicRole, elevatedRole],
    );
    await client.query(`UPDATE public.roles SET permissions='[]'::jsonb WHERE role='branch_manager'`);

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES
         ($1,$2,$3,'Direct Manager',$4,$5,true),
         ($6,$7,$8,'Label Manager','branch_manager',$5,true),
         ($9,$10,$11,'Target',$12,$5,true),
         ($13,$14,$15,'Self User',$12,$5,true)`,
      [
        managerId, `${randomUUID()}@test.local`, `dm_${randomUUID().slice(0,8)}`, managerRole, branchA,
        labelOnlyId, `${randomUUID()}@test.local`, `lm_${randomUUID().slice(0,8)}`,
        targetId, `${randomUUID()}@test.local`, `tg_${randomUUID().slice(0,8)}`, basicRole,
        selfUserId, `${randomUUID()}@test.local`, `su_${randomUUID().slice(0,8)}`,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('catalog guard is permission-first and hardened', async () => {
    const result = await client.query<{ def: string; cfg: string[] | null }>(
      `SELECT pg_get_functiondef(p.oid) AS def, p.proconfig AS cfg
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='guard_user_role_changes'`,
    );
    expect(result.rows[0].cfg).toContain('search_path=public, pg_temp');
    expect(result.rows[0].def).toContain("can_permission('users.manage')");
    expect(result.rows[0].def).not.toContain("v_caller_role = 'branch_manager'");
  });

  it('branch_manager label without users.manage cannot mutate another user directly', async () => {
    const result = await asUser(labelOnlyId, async () =>
      client.query(`UPDATE public.users SET full_name='Label Escalation' WHERE id=$1`, [targetId]),
    );
    expect(result.rowCount).toBe(0);

    const stored = await client.query<{ full_name: string }>(`SELECT full_name FROM public.users WHERE id=$1`, [targetId]);
    expect(stored.rows[0].full_name).toBe('Target');
  });

  it('arbitrary role with users.manage can mutate a same-branch user', async () => {
    const result = await asUser(managerId, async () =>
      client.query(`UPDATE public.users SET full_name='Managed Correctly' WHERE id=$1`, [targetId]),
    );
    expect(result.rowCount).toBe(1);

    const stored = await client.query<{ full_name: string }>(`SELECT full_name FROM public.users WHERE id=$1`, [targetId]);
    expect(stored.rows[0].full_name).toBe('Managed Correctly');
  });

  it('users.manage cannot assign permissions the caller does not own', async () => {
    const savepoint = `qa_guard_${randomUUID().replace(/-/g,'')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await expect(asUser(managerId, async () =>
        client.query(`UPDATE public.users SET role=$1 WHERE id=$2`, [elevatedRole, targetId]),
      )).rejects.toThrow(/cannot assign role containing permission accounts\.manage|PERMISSION_DENIED/i);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  });

  it('users.manage cannot move a user to an inaccessible branch', async () => {
    const savepoint = `qa_scope_${randomUUID().replace(/-/g,'')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await asUser(managerId, async () =>
        client.query(`UPDATE public.users SET branch_id=$1 WHERE id=$2`, [branchB, targetId]),
      );
      expect(result.rowCount).toBe(0);
    } catch (error) {
      expect(String(error)).toMatch(/TARGET_OUT_OF_SCOPE|row-level security|permission/i);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  });

  it('normal user may edit own profile but cannot self-escalate role', async () => {
    const profile = await asUser(selfUserId, async () =>
      client.query(`UPDATE public.users SET full_name='Self Profile Edit' WHERE id=$1`, [selfUserId]),
    );
    expect(profile.rowCount).toBe(1);

    const savepoint = `qa_self_${randomUUID().replace(/-/g,'')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await expect(asUser(selfUserId, async () =>
        client.query(`UPDATE public.users SET role=$1 WHERE id=$2`, [managerRole, selfUserId]),
      )).rejects.toThrow(/cannot change their own role|PERMISSION_DENIED/i);
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  });

  it('internal users triggers use hardened search paths', async () => {
    const rows = await client.query<{ proname: string; cfg: string[] | null }>(
      `SELECT proname,proconfig AS cfg
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND proname IN ('_ensure_branch_access_after_user_create','protect_last_admin')`,
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) expect(row.cfg).toContain('search_path=public, pg_temp');
  });
});
