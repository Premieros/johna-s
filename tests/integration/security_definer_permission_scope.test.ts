import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('SECURITY DEFINER permission and branch scope', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('requires branches.manage plus canonical branch access for branch mutations', async () => {
    const r = await client.query<{ fn: string; def: string; config: string[] | null }>(`
      SELECT
        p.oid::regprocedure::text AS fn,
        pg_get_functiondef(p.oid) AS def,
        p.proconfig AS config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('update_branch', 'deactivate_branch')
      ORDER BY 1
    `);

    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.def).toContain("can_permission('branches.manage')");
      expect(row.def).toContain('user_may_access_branch(p_branch_id)');
      expect(row.def).not.toContain('user_can_access_organization');
      expect(row.config?.some((x) => x.includes('pg_temp'))).toBe(true);
    }
  });

  it('requires reports.costing and branch scope for sensitive costing reads', async () => {
    const r = await client.query<{ fn: string; def: string; config: string[] | null }>(`
      SELECT
        p.oid::regprocedure::text AS fn,
        pg_get_functiondef(p.oid) AS def,
        p.proconfig AS config
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_cost_history', 'get_production_variance')
      ORDER BY 1
    `);

    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.def).toContain("can_permission('reports.costing')");
      expect(row.def).toContain('user_may_access_branch');
      expect(row.config?.some((x) => x.includes('pg_temp'))).toBe(true);
    }
  });

  it('does not grant PUBLIC execute on the hardened functions', async () => {
    const r = await client.query<{ fn: string; public_execute: boolean }>(`
      SELECT
        p.oid::regprocedure::text AS fn,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('update_branch', 'deactivate_branch', 'get_cost_history', 'get_production_variance')
      ORDER BY 1
    `);

    expect(r.rows).toHaveLength(4);
    expect(r.rows.every((row) => row.public_execute === false)).toBe(true);
  });
});
