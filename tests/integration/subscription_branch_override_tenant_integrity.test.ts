import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture } from './rls';
import type { RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('subscription branch override tenant integrity', () => {
  let client: pg.Client;
  let canImp = false;
  let ids: RlsIds;
  let orgA: string;
  let orgB: string;
  let featureKey: string;

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

    featureKey = `tenant-integrity-${randomUUID()}`;
    await client.query(
      `INSERT INTO public.features (key, name, category, is_active, is_system)
       VALUES ($1, 'Tenant Integrity Test', 'management', true, false)`,
      [featureKey],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens super_admin_set_branch_override search path and grants', async () => {
    if (!canImp) return;
    const row = await client.query<{
      config: string[] | null;
      authenticated_execute: boolean;
      anon_execute: boolean;
      public_execute: boolean;
    }>(
      `SELECT p.proconfig AS config,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'super_admin_set_branch_override'
         AND pg_get_function_identity_arguments(p.oid) =
           'p_tenant_id uuid, p_branch_id uuid, p_feature_key text, p_enabled boolean, p_limit_value integer, p_reason text'`,
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].config ?? []).toContain('search_path=public, pg_temp');
    expect(row.rows[0].authenticated_execute).toBe(true);
    expect(row.rows[0].anon_execute).toBe(false);
    expect(row.rows[0].public_execute).toBe(false);
  });

  it('rejects a tenant/branch mismatch without writing override or event', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.super_admin,
      `SELECT public.super_admin_set_branch_override($1,$2,$3,true,NULL,'mismatch-test') AS result`,
      [orgB, ids.branchA, featureKey],
    );

    expect(res.error).toBeUndefined();
    expect(res.rows[0].result).toMatchObject({ success: false, error: 'BRANCH_TENANT_MISMATCH' });

    const overrides = await client.query(
      `SELECT 1
       FROM public.branch_feature_overrides bfo
       JOIN public.features f ON f.id = bfo.feature_id
       WHERE bfo.branch_id = $1 AND f.key = $2`,
      [ids.branchA, featureKey],
    );
    expect(overrides.rows).toHaveLength(0);

    const events = await client.query(
      `SELECT 1
       FROM public.subscription_events
       WHERE tenant_id = $1
         AND metadata->>'branch_id' = $2
         AND metadata->>'feature_key' = $3`,
      [orgB, ids.branchA, featureKey],
    );
    expect(events.rows).toHaveLength(0);
  });

  it('preserves Super Admin success for a matching tenant and branch', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.super_admin,
      `SELECT public.super_admin_set_branch_override($1,$2,$3,true,7,'matching-test') AS result`,
      [orgA, ids.branchA, featureKey],
    );

    expect(res.error).toBeUndefined();
    expect(res.rows[0].result).toMatchObject({ success: true });

    const override = await client.query<{ tenant_id: string; branch_id: string; enabled: boolean; limit_value: number }>(
      `SELECT bfo.tenant_id, bfo.branch_id, bfo.enabled, bfo.limit_value
       FROM public.branch_feature_overrides bfo
       JOIN public.features f ON f.id = bfo.feature_id
       WHERE bfo.branch_id = $1 AND f.key = $2`,
      [ids.branchA, featureKey],
    );
    expect(override.rows).toHaveLength(1);
    expect(override.rows[0]).toMatchObject({
      tenant_id: orgA,
      branch_id: ids.branchA,
      enabled: true,
      limit_value: 7,
    });

    const events = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id
       FROM public.subscription_events
       WHERE tenant_id = $1
         AND metadata->>'branch_id' = $2
         AND metadata->>'feature_key' = $3`,
      [orgA, ids.branchA, featureKey],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].tenant_id).toBe(orgA);
  });

  it('keeps non-Super-Admin callers unauthorized', async () => {
    if (!canImp) return;
    const res = await runAs(
      client,
      ids.users.owner,
      `SELECT public.super_admin_set_branch_override($1,$2,$3,true,NULL,'unauthorized-test') AS result`,
      [orgA, ids.branchA, featureKey],
    );

    expect(res.error).toBeUndefined();
    expect(res.rows[0].result).toMatchObject({ success: false, error: 'UNAUTHORIZED' });
  });
});
