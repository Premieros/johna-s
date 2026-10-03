import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('system health branch pulse and user issue telemetry', () => {
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

  it('returns a scoped branch pulse to a super admin', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      "SELECT public.get_branch_activity_snapshot(now() - interval '30 minutes', now() + interval '1 minute', $1) AS r",
      [ids.branchA],
    );

    expect(result.error).toBeUndefined();
    const payload = result.rows[0].r as { success?: boolean; branches?: Array<Record<string, unknown>> };
    expect(payload.success).toBe(true);
    expect(payload.branches).toHaveLength(1);
    expect(payload.branches?.[0].branch_id).toBe(ids.branchA);
    expect(['ok', 'quiet', 'warning']).toContain(payload.branches?.[0].signal_status);
  });

  it('denies Branch Pulse reads to a cashier without settings.manage', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const result = await runAsPersist(
      client,
      ids.users.cashier,
      "SELECT public.get_branch_activity_snapshot(now() - interval '30 minutes', now(), $1) AS r",
      [ids.branchA],
    );

    expect(result.error).toBeUndefined();
    expect(result.rows[0].r).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  it('lets an authenticated user record only bounded telemetry through the RPC', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const result = await runAsPersist(
      client,
      ids.users.cashier,
      "SELECT public.record_user_issue($1, '/pos', 'toast_error', 'SHIFT_NOT_OPEN', 'There is no open shift right now.', 'expected', NULL, NULL, 'order', NULL) AS r",
      [ids.branchA],
    );

    expect(result.error).toBeUndefined();
    expect(result.rows[0].r).toMatchObject({ success: true });
  });

  it('keeps the telemetry table inaccessible to authenticated users', async () => {
    const acl = await client.query<{ select_ok: boolean; insert_ok: boolean }>(
      "SELECT has_table_privilege('authenticated','private.user_issue_events','SELECT') AS select_ok, has_table_privilege('authenticated','private.user_issue_events','INSERT') AS insert_ok",
    );

    expect(acl.rows[0]).toEqual({ select_ok: false, insert_ok: false });
  });

  it('lets System Health aggregate the recorded issue', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      "SELECT public.get_user_issue_summary(now() - interval '1 hour', now() + interval '1 minute', $1, 50) AS r",
      [ids.branchA],
    );

    expect(result.error).toBeUndefined();
    const payload = result.rows[0].r as { success?: boolean; issues?: Array<Record<string, unknown>> };
    expect(payload.success).toBe(true);
    const issue = payload.issues?.find((row) => row.error_code === 'SHIFT_NOT_OPEN');
    expect(issue).toMatchObject({
      branch_id: ids.branchA,
      issue_kind: 'expected',
      error_code: 'SHIFT_NOT_OPEN',
      screen: '/pos',
      action: 'toast_error',
    });
    expect(Number(issue?.occurrences ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('keeps anon execution revoked while authenticated users can call bounded RPCs', async () => {
    const acl = await client.query<{
      pulse_anon: boolean;
      pulse_auth: boolean;
      issue_anon: boolean;
      issue_auth: boolean;
      summary_anon: boolean;
      summary_auth: boolean;
    }>(
      "SELECT has_function_privilege('anon','public.get_branch_activity_snapshot(timestamptz,timestamptz,uuid)','EXECUTE') AS pulse_anon, has_function_privilege('authenticated','public.get_branch_activity_snapshot(timestamptz,timestamptz,uuid)','EXECUTE') AS pulse_auth, has_function_privilege('anon','public.record_user_issue(uuid,text,text,text,text,text,text,text,text,uuid)','EXECUTE') AS issue_anon, has_function_privilege('authenticated','public.record_user_issue(uuid,text,text,text,text,text,text,text,text,uuid)','EXECUTE') AS issue_auth, has_function_privilege('anon','public.get_user_issue_summary(timestamptz,timestamptz,uuid,integer)','EXECUTE') AS summary_anon, has_function_privilege('authenticated','public.get_user_issue_summary(timestamptz,timestamptz,uuid,integer)','EXECUTE') AS summary_auth",
    );

    expect(acl.rows[0]).toEqual({
      pulse_anon: false,
      pulse_auth: true,
      issue_anon: false,
      issue_auth: true,
      summary_anon: false,
      summary_auth: true,
    });
  });
});
