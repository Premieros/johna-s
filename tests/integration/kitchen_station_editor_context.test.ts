import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('kitchen station editor context', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["settings.manage"]'::jsonb
       WHERE role = 'branch_manager'`,
    );
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

  guarded('branch manager receives only the selected branch users and categories', async () => {
    const result = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_kitchen_station_editor_context($1::uuid) AS context',
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    const context = result.rows[0].context as {
      success: boolean;
      branch: { id: string; name: string };
      users: Array<{ id: string }>;
      categories: Array<{ id: string }>;
    };
    expect(context.success).toBe(true);
    expect(context.branch.id).toBe(ids.branchA);
    expect(context.categories.map((row) => row.id)).toContain(ids.catA);
    expect(context.categories.map((row) => row.id)).not.toContain(ids.catB);
    expect(context.users.map((row) => row.id)).toContain(ids.users.cashier);
    expect(context.users.map((row) => row.id)).not.toContain(ids.users.cashier_b);
  });

  guarded('branch manager cannot load another branch editor context', async () => {
    const result = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_kitchen_station_editor_context($1::uuid) AS context',
      [ids.branchB],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].context).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  guarded('cashier cannot open the station editor context', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT public.get_kitchen_station_editor_context($1::uuid) AS context',
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].context).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });

  guarded('super admin can load an allowed branch context', async () => {
    const result = await runAs(
      client,
      ids.users.super_admin,
      'SELECT public.get_kitchen_station_editor_context($1::uuid) AS context',
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].context).toMatchObject({ success: true, branch: { id: ids.branchA } });
  });
});
