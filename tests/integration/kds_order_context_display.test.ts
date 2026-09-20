import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('KDS order context display contract', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('is permission-first, branch-scoped and read-only', async () => {
    const row = await client.query<{
      definition: string;
      security_definer: boolean;
      config: string[] | null;
      auth_exec: boolean;
      anon_exec: boolean;
    }>(
      `SELECT
         pg_get_functiondef(p.oid) AS definition,
         p.prosecdef AS security_definer,
         p.proconfig AS config,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname='get_kitchen_order_context'
       LIMIT 1`,
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].security_definer).toBe(true);
    expect(row.rows[0].config ?? []).toContain('search_path=public, pg_temp');
    expect(row.rows[0].auth_exec).toBe(true);
    expect(row.rows[0].anon_exec).toBe(false);
    expect(row.rows[0].definition).toContain("public.can_permission('pos.kds_view')");
    expect(row.rows[0].definition).toContain('public.user_may_access_branch');
    expect(row.rows[0].definition).toContain('public.get_kitchen_queue');
    expect(row.rows[0].definition).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
  });
});
