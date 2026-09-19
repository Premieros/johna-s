import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('financial visibility admin controls', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx: { skip?: () => unknown }) => {
      if (!imp) return typeof ctx.skip === 'function' ? ctx.skip() : undefined;
      await fn();
    });

  guarded('only super_admin can read the policy RPC', async () => {
    const superResult = await runAs(
      client,
      ids.users.super_admin,
      'SELECT public.get_financial_visibility_settings() AS settings',
    );
    const ownerResult = await runAs(
      client,
      ids.users.owner,
      'SELECT public.get_financial_visibility_settings() AS settings',
    );

    expect(superResult.error).toBeUndefined();
    expect(superResult.rows[0].settings).toMatchObject({ success: true, recent_days: 7, historical_percent: 30 });
    expect(ownerResult.error).toBeUndefined();
    expect(ownerResult.rows[0].settings).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  guarded('only super_admin can update the policy', async () => {
    const ownerResult = await runAs(
      client,
      ids.users.owner,
      'SELECT public.update_financial_visibility_settings(14, 55) AS result',
    );
    expect(ownerResult.error).toBeUndefined();
    expect(ownerResult.rows[0].result).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });

    const superResult = await runAs(
      client,
      ids.users.super_admin,
      'SELECT public.update_financial_visibility_settings(14, 55) AS result',
    );
    expect(superResult.error).toBeUndefined();
    expect(superResult.rows[0].result).toMatchObject({ success: true, recent_days: 14, historical_percent: 55 });
  });

  guarded('financial history remains complete regardless of legacy sampling settings', async () => {
    const rowId = randomUUID();

    const setAllHidden = await runAsPersist(
      client,
      ids.users.super_admin,
      'SELECT public.update_financial_visibility_settings(7, 0) AS result',
    );
    expect(setAllHidden.error).toBeUndefined();
    expect(setAllHidden.rows[0].result).toMatchObject({ success: true, recent_days: 7, historical_percent: 0 });

    const ownBranch = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now() - interval '30 days') AS allowed`,
      [rowId, ids.branchA],
    );
    expect(ownBranch.error).toBeUndefined();
    expect(ownBranch.rows[0].allowed).toBe(true);

    const otherBranch = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now() - interval '30 days') AS allowed`,
      [rowId, ids.branchB],
    );
    expect(otherBranch.error).toBeUndefined();
    expect(otherBranch.rows[0].allowed).toBe(false);
  });

  guarded('active orders remain fully visible even with zero historical percentage', async () => {
    const setAllHidden = await runAsPersist(
      client,
      ids.users.super_admin,
      'SELECT public.update_financial_visibility_settings(7, 0) AS result',
    );
    expect(setAllHidden.error).toBeUndefined();

    const active = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.order_read_visible($1::uuid, $2::uuid, 'held', now() - interval '90 days') AS allowed`,
      [randomUUID(), ids.branchA],
    );
    expect(active.error).toBeUndefined();
    expect(active.rows[0].allowed).toBe(true);
  });
});
