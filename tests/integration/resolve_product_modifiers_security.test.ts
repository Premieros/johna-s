import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('resolve_product_modifiers security boundary', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('authorizes branch access before product/modifier lookups', async () => {
    const { rows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(
        'public.resolve_product_modifiers(uuid,uuid,jsonb)'::regprocedure
      ) AS definition
    `);

    const definition = rows[0]?.definition ?? '';
    const authPos = definition.indexOf('auth.uid() IS NULL');
    const userPos = definition.indexOf('u.id = auth.uid()');
    const branchPos = definition.indexOf('user_may_access_branch');
    const productPos = definition.indexOf('FROM public.products p');
    const optionPos = definition.indexOf('product_modifier_options');

    expect(authPos).toBeGreaterThan(-1);
    expect(userPos).toBeGreaterThan(authPos);
    expect(branchPos).toBeGreaterThan(userPos);
    expect(productPos).toBeGreaterThan(branchPos);
    expect(optionPos).toBeGreaterThan(productPos);
  });

  it('keeps anon denied while preserving authenticated/service API grants', async () => {
    const { rows } = await client.query<{
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
    }>(`
      SELECT
        has_function_privilege('anon', 'public.resolve_product_modifiers(uuid,uuid,jsonb)', 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', 'public.resolve_product_modifiers(uuid,uuid,jsonb)', 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', 'public.resolve_product_modifiers(uuid,uuid,jsonb)', 'EXECUTE') AS service_exec
    `);

    expect(rows[0]).toEqual({
      anon_exec: false,
      auth_exec: true,
      service_exec: true,
    });
  });

  it('returns branch mismatch before revealing a foreign product', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const foreign = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.resolve_product_modifiers($1,$2,'[]'::jsonb) AS r`,
      [ids.prodB, ids.branchB],
    );
    if (foreign.error) throw new Error(foreign.error);
    expect(foreign.rows[0]?.r).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });

    const own = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.resolve_product_modifiers($1,$2,'[]'::jsonb) AS r`,
      [ids.prodA, ids.branchA],
    );
    if (own.error) throw new Error(own.error);
    expect(own.rows[0]?.r).toMatchObject({ success: true });
  });
});
