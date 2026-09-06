import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const targets = [
  ['is_super_admin', ''],
  ['admin_data_delete_section', 'p_branch_id uuid, p_section text'],
  ['admin_data_seed_all', 'p_branch_id uuid'],
  ['verify_auth_account', 'p_user_id uuid'],
  ['repair_auth_account', 'p_user_id uuid'],
  ['toggle_organization_status', 'p_org_id uuid, p_is_active boolean'],
] as const;

describe.skipIf(!dbUrl)('admin SECURITY DEFINER hardening', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('uses public, pg_temp search_path and authenticated-only execute', async () => {
    for (const [name, args] of targets) {
      const row = await client.query<{
        config: string[] | null;
        authenticated_execute: boolean;
        anon_execute: boolean;
      }>(
        `SELECT p.proconfig AS config,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = $1
           AND pg_get_function_identity_arguments(p.oid) = $2`,
        [name, args],
      );

      expect(row.rows, `${name}(${args})`).toHaveLength(1);
      expect(row.rows[0].config ?? [], `${name} search_path`).toContain('search_path=public, pg_temp');
      expect(row.rows[0].authenticated_execute, `${name} authenticated execute`).toBe(true);
      expect(row.rows[0].anon_execute, `${name} anon execute`).toBe(false);
    }
  });

  it('preserves Super Admin-only authorization contracts', async () => {
    const rows = await client.query<{ name: string; definition: string }>(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [[
        'is_super_admin',
        'admin_data_delete_section',
        'admin_data_seed_all',
        'verify_auth_account',
        'repair_auth_account',
        'toggle_organization_status',
      ]],
    );

    const byName = new Map(rows.rows.map((row) => [row.name, row.definition]));

    expect(byName.get('is_super_admin')).toContain('auth.uid()');
    expect(byName.get('is_super_admin')).toContain("role = 'super_admin'");

    for (const name of [
      'admin_data_delete_section',
      'admin_data_seed_all',
      'verify_auth_account',
      'repair_auth_account',
    ]) {
      expect(byName.get(name), `${name} Super Admin guard`).toContain('public.is_super_admin()');
    }

    expect(byName.get('toggle_organization_status')).toContain('public.is_platform_admin()');
  });
});
