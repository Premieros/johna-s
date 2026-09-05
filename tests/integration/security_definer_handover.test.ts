import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('P0-B SECURITY DEFINER handover hardening', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('keeps the production schema sentinel callable without SECURITY DEFINER', async () => {
    const r = await client.query<{ prosecdef: boolean; anon_exec: boolean }>(`
      SELECT p.prosecdef,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='_production_schema_contract_kitchen_v1'
    `);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].prosecdef).toBe(false);
    expect(r.rows[0].anon_exec).toBe(true);
  });

  it('guards global Super Admin read RPCs with the canonical admin predicate', async () => {
    const r = await client.query<{ fn: string; def: string; anon_exec: boolean }>(`
      SELECT p.proname AS fn,
             pg_get_functiondef(p.oid) AS def,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('get_super_admin_all_users','get_super_admin_tenant_stats')
      ORDER BY p.proname
    `);
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.def).toContain('public.is_pos_admin()');
      expect(row.def).toContain('SECURITY DEFINER');
      expect(row.def).toContain('search_path TO');
      expect(row.anon_exec).toBe(false);
      expect(row.def).not.toContain("'owner'");
    }
  });
});
