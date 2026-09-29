import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('business-day future-close integrity guard', () => {
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

  it('does not let a future daily_close drag a new live shift into the future', async () => {
    const dates = await client.query<{ current_d: string; future_d: string }>(
      `SELECT
         private.current_fixed_business_date($1,now())::text AS current_d,
         (private.current_fixed_business_date($1,now())+1)::text AS future_d`,
      [ids.branchA],
    );
    const { current_d: currentDate, future_d: futureDate } = dates.rows[0];

    await client.query(
      `INSERT INTO public.daily_closes(
         branch_id,business_date,status,closed_at,closed_by,report_snapshot
       )
       VALUES($1,$2::date,'closed',now(),$3,'{"fixture":"future-close"}'::jsonb)`,
      [ids.branchA, futureDate, ids.users.super_admin],
    );

    const first = await client.query<{ d: string }>(
      `SELECT (public._ensure_business_day_state($1)->>'business_date')::text AS d`,
      [ids.branchA],
    );
    expect(first.rows[0].d).toBe(currentDate);

    const second = await client.query<{ d: string }>(
      `SELECT (public._ensure_business_day_state($1)->>'business_date')::text AS d`,
      [ids.branchA],
    );
    expect(second.rows[0].d).toBe(currentDate);
  });

  it('blocks a corrupted future state from rolling forward again', async () => {
    const dates = await client.query<{ future_d: string; next_d: string }>(
      `SELECT
         (private.current_fixed_business_date($1,now())+1)::text AS future_d,
         (private.current_fixed_business_date($1,now())+2)::text AS next_d`,
      [ids.branchA],
    );
    const { future_d: futureDate, next_d: nextDate } = dates.rows[0];

    await client.query(
      `UPDATE public.business_day_state
       SET business_date=$2::date,
           started_at=(SELECT opened_at FROM public.shifts WHERE id=$3),
           updated_at=now()
       WHERE branch_id=$1`,
      [ids.branchA, futureDate, ids.shiftA],
    );

    const before = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, futureDate],
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

    const after = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, futureDate],
    );
    expect(after.rows[0].c).toBe(before.rows[0].c);

    const skipped = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, nextDate],
    );
    expect(Number(skipped.rows[0].c)).toBe(0);
  });
});
