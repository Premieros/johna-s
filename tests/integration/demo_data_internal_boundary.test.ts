import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('demo data helpers — internal service boundary', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('removes authenticated/anon execution and hardens search_path', async () => {
    const { rows } = await client.query<{
      proname: string;
      proconfig: string[];
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
      def: string;
    }>(`
      SELECT p.proname,
             p.proconfig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec,
             pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('seed_demo_data', 'delete_demo_data')
      ORDER BY p.proname
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.proconfig).toContain('search_path=public, pg_temp');
      expect(row.anon_exec).toBe(false);
      expect(row.auth_exec).toBe(false);
      expect(row.service_exec).toBe(true);
      expect(row.def).not.toContain('is_branch_manager()');
      expect(row.def).not.toContain('is_pos_admin()');
    }
  });

  it('authenticated callers cannot invoke either helper directly', async () => {
    await client.query('SAVEPOINT auth_demo_probe');
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await expect(
        client.query(`SELECT public.seed_demo_data($1)`, [ids.branchA]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT auth_demo_probe');
      await client.query('RELEASE SAVEPOINT auth_demo_probe');
      await client.query('SET LOCAL ROLE postgres');
    }

    await client.query('SAVEPOINT auth_demo_delete_probe');
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await expect(
        client.query(`SELECT public.delete_demo_data($1)`, [ids.branchA]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT auth_demo_delete_probe');
      await client.query('RELEASE SAVEPOINT auth_demo_delete_probe');
      await client.query('SET LOCAL ROLE postgres');
    }
  });

  it('service role can seed idempotently and delete demo data end-to-end', async () => {
    await client.query('SET LOCAL ROLE service_role');
    const seeded = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public.seed_demo_data($1) AS r`,
      [ids.branchA],
    );
    await client.query('SET LOCAL ROLE postgres');

    expect(seeded.rows[0].r.success).toBe(true);
    expect(seeded.rows[0].r.existing).toBe(false);
    expect(seeded.rows[0].r.products).toBe(8);

    const counts = await client.query<{ products: string; customers: string; tables: string }>(`
      SELECT
        (SELECT count(*)::text FROM public.products WHERE branch_id=$1 AND is_demo) AS products,
        (SELECT count(*)::text FROM public.customers WHERE branch_id=$1 AND is_demo) AS customers,
        (SELECT count(*)::text FROM public.dining_tables WHERE branch_id=$1 AND is_demo) AS tables
    `, [ids.branchA]);
    expect(Number(counts.rows[0].products)).toBe(8);
    expect(Number(counts.rows[0].customers)).toBe(2);
    expect(Number(counts.rows[0].tables)).toBe(4);

    await client.query('SET LOCAL ROLE service_role');
    const seededAgain = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public.seed_demo_data($1) AS r`,
      [ids.branchA],
    );
    await client.query('SET LOCAL ROLE postgres');
    expect(seededAgain.rows[0].r.success).toBe(true);
    expect(seededAgain.rows[0].r.existing).toBe(true);

    await client.query('SET LOCAL ROLE service_role');
    const deleted = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public.delete_demo_data($1) AS r`,
      [ids.branchA],
    );
    await client.query('SET LOCAL ROLE postgres');
    expect(deleted.rows[0].r.success).toBe(true);

    const after = await client.query<{ products: string; customers: string; tables: string }>(`
      SELECT
        (SELECT count(*)::text FROM public.products WHERE branch_id=$1 AND is_demo) AS products,
        (SELECT count(*)::text FROM public.customers WHERE branch_id=$1 AND is_demo) AS customers,
        (SELECT count(*)::text FROM public.dining_tables WHERE branch_id=$1 AND is_demo) AS tables
    `, [ids.branchA]);
    expect(Number(after.rows[0].products)).toBe(0);
    expect(Number(after.rows[0].customers)).toBe(0);
    expect(Number(after.rows[0].tables)).toBe(0);
  });
});
