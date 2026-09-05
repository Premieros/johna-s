import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('P0-B privileged SECURITY DEFINER guards', () => {
  let client: pg.Client;
  const normalUserId = randomUUID();
  const superAdminId = randomUUID();

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

  async function expectPermissionDenied(fn: () => Promise<unknown>): Promise<void> {
    const savepoint = `sp_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    let message = '';
    try {
      await fn();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    expect(message).toContain('PERMISSION_DENIED:super_admin');
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, is_active)
       VALUES ($1, $2, 'P0-B ordinary user', 'cashier', true),
              ($3, $4, 'P0-B super admin', 'super_admin', true)`,
      [normalUserId, `${randomUUID()}@test.local`, superAdminId, `${randomUUID()}@test.local`],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('blocks an ordinary authenticated user from cross-user Super Admin data', async () => {
    await expectPermissionDenied(() =>
      asUser(normalUserId, () => client.query(`SELECT * FROM public.get_super_admin_all_users(NULL)`)),
    );
  });

  it('blocks an ordinary authenticated user from global tenant statistics', async () => {
    await expectPermissionDenied(() =>
      asUser(normalUserId, () => client.query(`SELECT * FROM public.get_super_admin_tenant_stats()`)),
    );
  });

  it('allows the Super Admin to call both privileged RPCs', async () => {
    await asUser(superAdminId, async () => {
      await client.query(`SELECT * FROM public.get_super_admin_all_users(NULL) LIMIT 1`);
      await client.query(`SELECT * FROM public.get_super_admin_tenant_stats() LIMIT 1`);
    });
  });

  it('does not grant anon EXECUTE on the privileged RPCs', async () => {
    const acl = await client.query<{ anon_users: boolean; anon_stats: boolean }>(`
      SELECT
        has_function_privilege('anon', 'public.get_super_admin_all_users(text)', 'EXECUTE') AS anon_users,
        has_function_privilege('anon', 'public.get_super_admin_tenant_stats()', 'EXECUTE') AS anon_stats
    `);
    expect(acl.rows[0]).toEqual({ anon_users: false, anon_stats: false });
  });
});
