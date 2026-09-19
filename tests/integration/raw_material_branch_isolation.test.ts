import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, uniq } from './rls';
import type { RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('Raw material branch isolation', () => {
  let client: pg.Client;
  let canImp = false;
  let ids: RlsIds;
  let rawA = '';
  let rawB = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    canImp = await canImpersonate(client);
    if (!canImp) return;

    ids = await seedRlsFixture(client);

    rawA = (
      await client.query<{ id: string }>(
        `INSERT INTO public.raw_materials (code, name, branch_id)
         VALUES ($1, 'RLS Raw A', $2)
         RETURNING id`,
        [uniq('RLS-RAW-A'), ids.branchA],
      )
    ).rows[0].id;

    rawB = (
      await client.query<{ id: string }>(
        `INSERT INTO public.raw_materials (code, name, branch_id)
         VALUES ($1, 'RLS Raw B', $2)
         RETURNING id`,
        [uniq('RLS-RAW-B'), ids.branchB],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('branch manager sees own-branch raw material and not another branch', async () => {
    if (!canImp) return;

    const own = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT id FROM public.raw_materials WHERE id = $1',
      [rawA],
    );
    expect(own.error).toBeUndefined();
    expect(own.rows).toHaveLength(1);

    const other = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT id FROM public.raw_materials WHERE id = $1',
      [rawB],
    );
    expect(other.error).toBeUndefined();
    expect(other.rows).toHaveLength(0);
  });

  it('same-branch read remains available without broadening cross-branch access', async () => {
    if (!canImp) return;

    const own = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.raw_materials WHERE id = $1',
      [rawA],
    );
    expect(own.error).toBeUndefined();
    expect(own.rows).toHaveLength(1);

    const other = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.raw_materials WHERE id = $1',
      [rawB],
    );
    expect(other.error).toBeUndefined();
    expect(other.rows).toHaveLength(0);
  });

  it('Super Admin keeps platform-wide read access', async () => {
    if (!canImp) return;

    const res = await runAs(
      client,
      ids.users.super_admin,
      'SELECT id FROM public.raw_materials WHERE id = ANY($1::uuid[])',
      [[rawA, rawB]],
    );

    expect(res.error).toBeUndefined();
    expect(res.rows).toHaveLength(2);
  });
});
