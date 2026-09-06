import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('next_document_number security boundary', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('does not grant direct EXECUTE to anon or authenticated', async () => {
    const { rows } = await client.query<{ anon_exec: boolean; auth_exec: boolean; service_exec: boolean }>(`
      SELECT
        has_function_privilege('anon', 'public.next_document_number(text)', 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', 'public.next_document_number(text)', 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', 'public.next_document_number(text)', 'EXECUTE') AS service_exec
    `);

    expect(rows[0].anon_exec).toBe(false);
    expect(rows[0].auth_exec).toBe(false);
    expect(rows[0].service_exec).toBe(true);
  });

  it('remains callable through the backend service boundary', async () => {
    await client.query('SET LOCAL ROLE service_role');
    const { rows } = await client.query<{ result: { success?: boolean } }>(
      `SELECT public.next_document_number('handover_security_test') AS result`
    );
    await client.query('RESET ROLE');

    expect(rows[0].result?.success).toBe(true);
  });
});
