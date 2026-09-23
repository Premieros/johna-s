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

    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["settings.manage","history.unlimited"]'::jsonb
       WHERE role = 'branch_manager'`,
    );
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

  guarded('policy administration follows settings.manage rather than a role name', async () => {
    const managerResult = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_financial_visibility_settings() AS settings',
    );
    const cashierResult = await runAs(
      client,
      ids.users.cashier,
      'SELECT public.get_financial_visibility_settings() AS settings',
    );

    expect(managerResult.error).toBeUndefined();
    expect(managerResult.rows[0].settings).toMatchObject({ success: true, recent_days: 7, historical_percent: 30 });
    expect(cashierResult.error).toBeUndefined();
    expect(cashierResult.rows[0].settings).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  guarded('history.unlimited is the only historical visibility bypass', async () => {
    const oldRow = randomUUID();

    const setAllHidden = await runAsPersist(
      client,
      ids.users.branch_manager,
      'SELECT public.update_financial_visibility_settings(7, 0) AS result',
    );
    expect(setAllHidden.error).toBeUndefined();
    expect(setAllHidden.rows[0].result).toMatchObject({ success: true, recent_days: 7, historical_percent: 0 });

    const managerOld = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now() - interval '30 days') AS allowed`,
      [oldRow, ids.branchA],
    );
    const cashierOld = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now() - interval '30 days') AS allowed`,
      [oldRow, ids.branchA],
    );
    const cashierRecent = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now()) AS allowed`,
      [randomUUID(), ids.branchA],
    );

    expect(managerOld.error).toBeUndefined();
    expect(managerOld.rows[0].allowed).toBe(true);
    expect(cashierOld.error).toBeUndefined();
    expect(cashierOld.rows[0].allowed).toBe(false);
    expect(cashierRecent.error).toBeUndefined();
    expect(cashierRecent.rows[0].allowed).toBe(true);
  });

  guarded('configured historical percentage is deterministic and branch scoped', async () => {
    const rowId = randomUUID();

    const setAllVisible = await runAsPersist(
      client,
      ids.users.branch_manager,
      'SELECT public.update_financial_visibility_settings(7, 100) AS result',
    );
    expect(setAllVisible.error).toBeUndefined();

    const ownBranch = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now() - interval '30 days') AS allowed`,
      [rowId, ids.branchA],
    );
    const otherBranch = await runAs(
      client,
      ids.users.cashier,
      `SELECT private.financial_row_visible($1::uuid, $2::uuid, now() - interval '30 days') AS allowed`,
      [rowId, ids.branchB],
    );

    expect(ownBranch.error).toBeUndefined();
    expect(ownBranch.rows[0].allowed).toBe(true);
    expect(otherBranch.error).toBeUndefined();
    expect(otherBranch.rows[0].allowed).toBe(false);
  });

  guarded('active orders remain visible inside the branch even when historical percentage is zero', async () => {
    const setAllHidden = await runAsPersist(
      client,
      ids.users.branch_manager,
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
