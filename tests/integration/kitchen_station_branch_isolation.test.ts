import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('kitchen station branch isolation', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  let stationA = '';
  let stationB = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["settings.manage","pos.send_kitchen"]'::jsonb
       WHERE role = 'branch_manager'`,
    );

    const stations = await client.query(
      `SELECT branch_id, id
       FROM public.kitchen_stations
       WHERE branch_id = ANY($1::uuid[])
         AND code = 'main'
       ORDER BY branch_id`,
      [[ids.branchA, ids.branchB]],
    );
    stationA = stations.rows.find((row) => row.branch_id === ids.branchA)?.id ?? '';
    stationB = stations.rows.find((row) => row.branch_id === ids.branchB)?.id ?? '';
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

  it('materializes the same station code independently in both branches', () => {
    expect(stationA).toBeTruthy();
    expect(stationB).toBeTruthy();
    expect(stationA).not.toBe(stationB);
  });

  guarded('selected-branch assignments return only that branch stations', async () => {
    const result = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_kitchen_station_assignments($1::uuid) AS result',
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    const payload = result.rows[0].result as { success: boolean; stations: Array<{ id: string; branch_id: string; code: string }> };
    expect(payload.success).toBe(true);
    expect(payload.stations.length).toBeGreaterThan(0);
    expect(payload.stations.every((station) => station.branch_id === ids.branchA)).toBe(true);
    expect(payload.stations.some((station) => station.id === stationB)).toBe(false);
  });

  guarded('rejects assigning a category to a station owned by another branch', async () => {
    const result = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.save_kitchen_station_assignments(
         $1::uuid, $2::uuid, '{}'::uuid[], ARRAY[$3::uuid]
       ) AS result`,
      [ids.branchA, stationB, ids.catA],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'STATION_BRANCH_MISMATCH' });
  });

  it('database trigger rejects a direct cross-branch category station link', async () => {
    await expect(
      client.query(
        'UPDATE public.categories SET kitchen_station_id = $1::uuid WHERE id = $2::uuid',
        [stationB, ids.catA],
      ),
    ).rejects.toThrow(/KITCHEN_STATION_BRANCH_MISMATCH/);
  });

  guarded('cashier code cannot be created as a kitchen station', async () => {
    const result = await runAs(
      client,
      ids.users.branch_manager,
      `INSERT INTO public.kitchen_stations(branch_id, code, name_ar, name_en)
       VALUES ($1::uuid, 'cashier', 'كاشير', 'Cashier')
       RETURNING id`,
      [ids.branchA],
    );
    expect(result.error).toBeDefined();
  });

  guarded('a user with explicit multi-branch access can be assigned in that branch', async () => {
    await client.query(
      `INSERT INTO public.user_branch_access(user_id, branch_id)
       VALUES ($1::uuid, $2::uuid)
       ON CONFLICT DO NOTHING`,
      [ids.users.branch_manager, ids.branchB],
    );

    const result = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.save_kitchen_station_assignments(
         $1::uuid, $2::uuid, ARRAY[$3::uuid], '{}'::uuid[]
       ) AS result`,
      [ids.branchB, stationB, ids.users.branch_manager],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: true });
  });
});
