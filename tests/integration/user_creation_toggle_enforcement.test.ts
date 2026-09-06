import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type Rpc = { success?: boolean; error?: string; user_id?: string };

describe.skipIf(skip)('QA batch 1 — user creation toggle enforcement', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const managerId = randomUUID();
  const superAdminId = randomUUID();
  const managerRole = `qa_toggle_manager_${randomUUID().slice(0, 8)}`;
  const targetRole = `qa_toggle_target_${randomUUID().slice(0, 8)}`;

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

  async function create(userId: string, email: string): Promise<Rpc> {
    return asUser(userId, async () => {
      const result = await client.query<{ r: Rpc }>(
        `SELECT public.create_user($1,$2,$3,$4,$5,$6,$7) AS r`,
        [email, '4831', 'Toggle Test', targetRole, branchA, true, `toggle_${randomUUID().slice(0,8)}`],
      );
      return result.rows[0].r;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches(id,name) VALUES ($1,'Toggle Branch')`, [branchA]);
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES
         ($1,'مدير إنشاء','Creation manager','["users.manage"]'::jsonb,'global',true),
         ($2,'مستخدم اختبار','Toggle target','[]'::jsonb,'global',true)`,
      [managerRole, targetRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES
         ($1,$2,$3,'Toggle Manager',$4,$5,true),
         ($6,$7,$8,'Toggle Super Admin','super_admin',$5,true)`,
      [
        managerId, `${randomUUID()}@test.local`, `tm_${randomUUID().slice(0,8)}`, managerRole, branchA,
        superAdminId, `${randomUUID()}@test.local`, `tsa_${randomUUID().slice(0,8)}`,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens user-creation setting helpers', async () => {
    const rows = await client.query<{ proname: string; cfg: string[] | null }>(
      `SELECT proname,proconfig AS cfg
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND proname IN ('can_create_new_user','can_create_user','toggle_user_creation_setting')`,
    );
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) expect(row.cfg).toContain('search_path=public, pg_temp');
  });

  it('enforces allow_new_user_creation=false inside create_user itself', async () => {
    const sp = `qa_toggle_${randomUUID().replace(/-/g,'')}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const updated = await client.query(
        `UPDATE public.system_settings
         SET config=jsonb_set(COALESCE(config,'{}'::jsonb),'{security,allow_new_user_creation}','false'::jsonb,true)
         WHERE id=1`,
      );
      expect(updated.rowCount).toBe(1);

      const denied = await create(managerId, `blocked-${randomUUID()}@test.local`);
      expect(denied).toMatchObject({ success: false, error: 'USER_CREATION_DISABLED' });

      // Super Admin is the documented control-plane exception.
      const adminCreated = await create(superAdminId, `admin-${randomUUID()}@test.local`);
      expect(adminCreated.success).toBe(true);
      expect(adminCreated.user_id).toBeTruthy();
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    }
  });

  it('does not let users.manage toggle the global creation setting', async () => {
    const result = await asUser(managerId, async () => {
      const row = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.toggle_user_creation_setting(false) AS r`,
      );
      return row.rows[0].r;
    });
    expect(result).toMatchObject({ success: false, error: 'UNAUTHORIZED_SUPER_ADMIN_ONLY' });
  });
});
