import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture } from './rls';
import type { RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('subscription tenant scope', () => {
  let client: pg.Client;
  let canImp = false;
  let ids: RlsIds;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    canImp = await canImpersonate(client);
    if (!canImp) return;

    ids = await seedRlsFixture(client);
    const orgs = await client.query<{ branch_id: string; organization_id: string }>(
      `SELECT id AS branch_id, organization_id
       FROM public.branches
       WHERE id = ANY($1::uuid[])`,
      [[ids.branchA, ids.branchB]],
    );
    orgA = orgs.rows.find((row) => row.branch_id === ids.branchA)!.organization_id;
    orgB = orgs.rows.find((row) => row.branch_id === ids.branchB)!.organization_id;

    const planId = randomUUID();
    await client.query(
      `INSERT INTO public.plans (id, name, slug, is_active, is_public)
       VALUES ($1, 'Tenant Scope Test', $2, true, false)`,
      [planId, `tenant-scope-${planId}`],
    );
    await client.query(
      `INSERT INTO public.subscriptions (tenant_id, plan_id, status, current_period_end)
       VALUES ($1, $3, 'active', now() + interval '30 days'),
              ($2, $3, 'active', now() + interval '30 days')`,
      [orgA, orgB, planId],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens subscription_is_active and organization access helper', async () => {
    if (!canImp) return;
    for (const [name, args] of [
      ['subscription_is_active', 'p_tenant_id uuid'],
      ['user_can_access_organization', 'p_organization_id uuid'],
    ]) {
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
      expect(row.rows[0].authenticated_execute).toBe(true);
      expect(row.rows[0].anon_execute).toBe(false);
    }
  });

  it('allows an ordinary user to query their own active tenant', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.subscription_is_active($1) AS active`,
      [orgA],
    );
    expect(res.error).toBeUndefined();
    expect(res.rows[0].active).toBe(true);
  });

  it('preserves current-tenant inference when tenant_id is omitted', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.subscription_is_active(NULL) AS active`,
    );
    expect(res.error).toBeUndefined();
    expect(res.rows[0].active).toBe(true);
  });

  it('returns false for a foreign tenant without revealing its subscription status', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.subscription_is_active($1) AS active`,
      [orgB],
    );
    expect(res.error).toBeUndefined();
    expect(res.rows[0].active).toBe(false);
  });

  it('preserves Super Admin cross-tenant bypass', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.super_admin,
      `SELECT public.subscription_is_active($1) AS active`,
      [orgB],
    );
    expect(res.error).toBeUndefined();
    expect(res.rows[0].active).toBe(true);
  });
});
