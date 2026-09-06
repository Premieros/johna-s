import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('cancel_sent_order_item wrapper security boundary', () => {
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

  it('requires authentication and branch scope before sent-item lookup', async () => {
    const { rows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(
        'public.cancel_sent_order_item(uuid,uuid,numeric,text)'::regprocedure
      ) AS definition
    `);

    const definition = rows[0]?.definition ?? '';
    const authPos = definition.indexOf('auth.uid() IS NULL');
    const userPos = definition.indexOf('u.id = auth.uid()');
    const branchPos = definition.indexOf('user_may_access_branch');
    const itemLookupPos = definition.indexOf('FROM public.order_items oi');

    expect(authPos).toBeGreaterThan(-1);
    expect(userPos).toBeGreaterThan(authPos);
    expect(branchPos).toBeGreaterThan(userPos);
    expect(itemLookupPos).toBeGreaterThan(branchPos);
  });

  it('keeps the wrapper unavailable to anon while authenticated/service roles retain the API contract', async () => {
    const { rows } = await client.query<{
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
    }>(`
      SELECT
        has_function_privilege('anon', 'public.cancel_sent_order_item(uuid,uuid,numeric,text)', 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', 'public.cancel_sent_order_item(uuid,uuid,numeric,text)', 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', 'public.cancel_sent_order_item(uuid,uuid,numeric,text)', 'EXECUTE') AS service_exec
    `);

    expect(rows[0]).toEqual({
      anon_exec: false,
      auth_exec: true,
      service_exec: true,
    });
  });
});
