import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('SECURITY DEFINER search_path closure', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('has no authenticated-executable Production SECURITY DEFINER function with a legacy search_path', async () => {
    const result = await client.query<{ signature: string }>(`
      SELECT p.oid::regprocedure::text AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef
        AND p.proname NOT LIKE 'ci\\_%' ESCAPE '\\'
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT (
          COALESCE(p.proconfig, ARRAY[]::text[])
          @> ARRAY['search_path=public, pg_temp']
        )
      ORDER BY 1
    `);

    expect(result.rows, `legacy SECURITY DEFINER functions: ${result.rows.map((row) => row.signature).join(', ')}`).toEqual([]);
  });
});
