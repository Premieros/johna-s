import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('automatic fixed-time business-day close', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let dueDate = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    const dateRow = await client.query<{ d: string }>(
      `SELECT (((now() AT TIME ZONE 'Africa/Cairo')::date - 1))::text AS d`,
    );
    dueDate = dateRow.rows[0].d;

    await client.query(
      `UPDATE public.branch_settings
       SET business_day_mode='fixed_time',
           business_day_start='08:00'::time,
           business_day_end='02:30'::time
       WHERE branch_id=$1`,
      [ids.branchA],
    );

    await client.query(`DELETE FROM public.daily_closes WHERE branch_id=$1`, [ids.branchA]);
    await client.query(`DELETE FROM public.business_day_state WHERE branch_id=$1`, [ids.branchA]);

    await client.query(
      `UPDATE public.shifts
       SET status='open',
           opened_at=(($2::date + time '08:00') AT TIME ZONE 'Africa/Cairo'),
           closed_at=NULL
       WHERE id=$1`,
      [ids.shiftA, dueDate],
    );

    await client.query(
      `INSERT INTO public.business_day_state(branch_id,business_date,started_at,updated_at)
       VALUES(
         $1,
         $2::date,
         (($2::date + time '08:00') AT TIME ZONE 'Africa/Cairo'),
         now()
       )`,
      [ids.branchA, dueDate],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('closes a due day at the configured Cairo cutoff without closing the active shift', async () => {
    const result = await client.query<{ r: Record<string, unknown> }>(
      `SELECT private.run_due_business_day_closes() AS r`,
    );

    expect(Number(result.rows[0].r.closed_count)).toBeGreaterThanOrEqual(1);

    const close = await client.query<{
      business_date: string;
      closed_at: string;
      closed_by: string | null;
    }>(
      `SELECT business_date::text,closed_at::text,closed_by::text
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, dueDate],
    );

    expect(close.rowCount).toBe(1);
    expect(close.rows[0].business_date).toBe(dueDate);
    expect(close.rows[0].closed_by).toBeNull();

    const cutoff = await client.query<{ cutoff: string }>(
      `SELECT private.business_day_fixed_cutoff($1,$2::date)::text AS cutoff`,
      [ids.branchA, dueDate],
    );
    expect(new Date(close.rows[0].closed_at).getTime()).toBe(
      new Date(cutoff.rows[0].cutoff).getTime(),
    );

    const shift = await client.query<{ status: string }>(
      `SELECT status FROM public.shifts WHERE id=$1`,
      [ids.shiftA],
    );
    expect(shift.rows[0].status).toBe('open');

    const state = await client.query<{ business_date: string; started_at: string }>(
      `SELECT business_date::text,started_at::text
       FROM public.business_day_state
       WHERE branch_id=$1`,
      [ids.branchA],
    );
    expect(state.rows[0].business_date).not.toBe(dueDate);
    expect(new Date(state.rows[0].started_at).getTime()).toBe(
      new Date(cutoff.rows[0].cutoff).getTime(),
    );
  });

  it('is idempotent when the worker runs again', async () => {
    await client.query(`SELECT private.run_due_business_day_closes()`);

    const count = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, dueDate],
    );
    expect(Number(count.rows[0].c)).toBe(1);
  });

  it('does not expose the worker to authenticated users', async () => {
    const privilege = await client.query<{ allowed: boolean }>(
      `SELECT has_function_privilege(
         'authenticated',
         'private.run_due_business_day_closes()',
         'EXECUTE'
       ) AS allowed`,
    );
    expect(privilege.rows[0].allowed).toBe(false);
  });
});
