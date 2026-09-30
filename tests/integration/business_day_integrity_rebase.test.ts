import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('business-day integrity rebase', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    await client.query(
      `UPDATE public.branch_settings
       SET business_day_mode='fixed_time',
           business_day_start='08:00'::time,
           business_day_end='02:30'::time
       WHERE branch_id=$1`,
      [ids.branchA],
    );

    await client.query(
      `UPDATE public.shifts
       SET opened_at=now(), closed_at=NULL, status='open'
       WHERE id=$1`,
      [ids.shiftA],
    );

    await client.query(`DELETE FROM public.daily_closes WHERE branch_id=$1`, [ids.branchA]);
    await client.query(`DELETE FROM public.business_day_state WHERE branch_id=$1`, [ids.branchA]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('allows the state ceiling to advance after cutoff even before the next configured start', async () => {
    const row = await client.query<{ before_cutoff: string; after_cutoff: string }>(
      `SELECT
         private.max_reachable_business_state_date(
           $1,
           ((date '2026-09-30' + time '02:29') AT TIME ZONE 'Africa/Cairo')
         )::text AS before_cutoff,
         private.max_reachable_business_state_date(
           $1,
           ((date '2026-09-30' + time '02:31') AT TIME ZONE 'Africa/Cairo')
         )::text AS after_cutoff`,
      [ids.branchA],
    );
    expect(row.rows[0].before_cutoff).toBe('2026-09-29');
    expect(row.rows[0].after_cutoff).toBe('2026-09-30');
  });

  it('does not let a future daily_close drag a new live shift beyond the reachable state ceiling', async () => {
    const dates = await client.query<{ max_d: string; future_d: string }>(
      `SELECT
         private.max_reachable_business_state_date($1,now())::text AS max_d,
         (private.max_reachable_business_state_date($1,now())+1)::text AS future_d`,
      [ids.branchA],
    );
    const maxDate = dates.rows[0].max_d;
    const futureDate = dates.rows[0].future_d;

    await client.query(
      `INSERT INTO public.daily_closes(
         branch_id,business_date,status,closed_at,closed_by,report_snapshot
       )
       VALUES($1,$2::date,'closed',now(),$3,'{"fixture":"future-close"}'::jsonb)`,
      [ids.branchA, futureDate, ids.users.super_admin],
    );

    const state = await client.query<{ d: string; le_max: boolean }>(
      `SELECT
         (public._ensure_business_day_state($1)->>'business_date')::text AS d,
         ((SELECT business_date FROM public.business_day_state WHERE branch_id=$1) <= $2::date) AS le_max`,
      [ids.branchA, maxDate],
    );
    expect(state.rows[0].le_max).toBe(true);
    expect(state.rows[0].d).not.toBe(futureDate);
  });

  it('blocks a corrupted future state from rolling forward again', async () => {
    const dates = await client.query<{ future_d: string; next_d: string }>(
      `SELECT
         (private.max_reachable_business_state_date($1,now())+1)::text AS future_d,
         (private.max_reachable_business_state_date($1,now())+2)::text AS next_d`,
      [ids.branchA],
    );
    const futureDate = dates.rows[0].future_d;
    const nextDate = dates.rows[0].next_d;

    await client.query(
      `UPDATE public.business_day_state
       SET business_date=$2::date,
           started_at=(SELECT opened_at FROM public.shifts WHERE id=$3),
           updated_at=now()
       WHERE branch_id=$1`,
      [ids.branchA, futureDate, ids.shiftA],
    );

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.day_close($1,$2::date) AS r`,
      [ids.branchA, futureDate],
    );
    expect(result.error).toBeUndefined();
    const payload = result.rows[0].r as Record<string, unknown>;
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('BUSINESS_DAY_NOT_FINISHED');

    const skipped = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, nextDate],
    );
    expect(Number(skipped.rows[0].c)).toBe(0);
  });

  it('blocks no-open-shift day_close for a future/not-due business date', async () => {
    await client.query(
      `UPDATE public.shifts
       SET status='closed', closed_at=now()
       WHERE id=$1`,
      [ids.shiftA],
    );

    const target = await client.query<{ d: string }>(
      `SELECT (private.max_reachable_business_state_date($1,now())+1)::text AS d`,
      [ids.branchA],
    );

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.day_close($1,$2::date) AS r`,
      [ids.branchA, target.rows[0].d],
    );
    expect(result.error).toBeUndefined();
    const payload = result.rows[0].r as Record<string, unknown>;
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('BUSINESS_DAY_NOT_FINISHED');

    const close = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, target.rows[0].d],
    );
    expect(Number(close.rows[0].c)).toBe(0);
  });
});
