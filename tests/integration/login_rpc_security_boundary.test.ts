import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('anonymous login RPC security boundary', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('keeps public login RPCs invoker-only while preserving anon execute', async () => {
    const r = await client.query<{
      proname: string;
      security_definer: boolean;
      anon_execute: boolean;
      search_path: string[] | null;
    }>(`
      SELECT
        p.proname,
        p.prosecdef AS security_definer,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        p.proconfig AS search_path
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_login_email', 'record_login_failure')
      ORDER BY p.proname
    `);

    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.security_definer).toBe(false);
      expect(row.anon_execute).toBe(true);
      expect(row.search_path?.some((x) => x.includes('app_private'))).toBe(true);
      expect(row.search_path?.some((x) => x.includes('pg_temp'))).toBe(true);
    }
  });

  it('keeps the privileged implementations outside the exposed public schema', async () => {
    const r = await client.query<{
      proname: string;
      security_definer: boolean;
      anon_execute: boolean;
      search_path: string[] | null;
    }>(`
      SELECT
        p.proname,
        p.prosecdef AS security_definer,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        p.proconfig AS search_path
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app_private'
        AND p.proname IN ('get_login_email', 'record_login_failure')
      ORDER BY p.proname
    `);

    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.security_definer).toBe(true);
      expect(row.anon_execute).toBe(true);
      expect(row.search_path?.some((x) => x.includes('public'))).toBe(true);
      expect(row.search_path?.some((x) => x.includes('pg_temp'))).toBe(true);
    }
  });

  it('does not grant PUBLIC execute on either layer', async () => {
    const r = await client.query<{ schema_name: string; proname: string; public_execute: boolean }>(`
      SELECT
        n.nspname AS schema_name,
        p.proname,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'app_private')
        AND p.proname IN ('get_login_email', 'record_login_failure')
      ORDER BY 1, 2
    `);

    expect(r.rows).toHaveLength(4);
    expect(r.rows.every((row) => row.public_execute === false)).toBe(true);
  });
});
