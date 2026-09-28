import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('system health snapshot security and read-only contract', () => {
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

  it('returns branch-scoped operational invariants to a super admin', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.get_system_health_snapshot($1) AS r`,
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    const r = result.rows[0].r as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.branch_id).toBe(ids.branchA);
    for (const key of [
      'active_shifts',
      'duplicate_open_shift_branches',
      'open_orders',
      'stale_empty_open_orders',
      'unbalanced_journal_entries',
      'sale_payment_detail_mismatch',
      'sale_item_refund_integrity_violations',
      'live_kitchen_inventory_mismatch',
      'active_print_jobs',
      'stale_active_print_jobs',
      'pending_work_authorizations',
    ]) {
      expect(Number(r[key] ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is unavailable to anon but executable by authenticated users', async () => {
    const acl = await client.query<{ anon_exec: boolean; auth_exec: boolean }>(
      `SELECT
        has_function_privilege('anon','public.get_system_health_snapshot(uuid)','EXECUTE') AS anon_exec,
        has_function_privilege('authenticated','public.get_system_health_snapshot(uuid)','EXECUTE') AS auth_exec`,
    );
    expect(acl.rows[0]).toEqual({ anon_exec: false, auth_exec: true });
  });

  it('denies a normal user without settings.manage', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const result = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.get_system_health_snapshot($1) AS r`,
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].r).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });
});
