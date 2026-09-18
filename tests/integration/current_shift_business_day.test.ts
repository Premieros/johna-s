import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('current shift live business-day scope', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let businessDate = '';
  let activeShiftId = '';
  let activeOpenedAt = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    const clock = await client.query<{ business_date: string; start_time: string }>(
      `SELECT
         (((now() AT TIME ZONE 'Africa/Cairo') - interval '1 hour')::date)::text AS business_date,
         (((now() AT TIME ZONE 'Africa/Cairo') - interval '1 hour')::time)::text AS start_time`,
    );
    businessDate = clock.rows[0].business_date;

    await client.query(
      `UPDATE public.branch_settings
       SET business_day_mode='shift_span',
           business_day_start=$2::time
       WHERE branch_id=$1`,
      [ids.branchA, clock.rows[0].start_time],
    );

    await client.query(
      `UPDATE public.shifts
       SET opened_at=now()-interval '50 minutes',
           closed_at=now()-interval '40 minutes',
           status='closed'
       WHERE id=$1`,
      [ids.shiftA],
    );

    const active = await client.query<{ id: string; opened_at: string }>(
      `INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status,opened_at)
       VALUES($1,$2,0,'open',now()-interval '20 minutes')
       RETURNING id,opened_at::text`,
      [ids.branchA, ids.users.cashier],
    );
    activeShiftId = active.rows[0].id;
    activeOpenedAt = active.rows[0].opened_at;

    await client.query(
      `INSERT INTO public.expenses
        (id,category,description,amount,branch_id,expense_date,payment_method,status,created_by,created_at)
       VALUES
        ($1,'ops','previous shift expense',11,$3,CURRENT_DATE,'cash','posted',$4,now()-interval '35 minutes'),
        ($2,'ops','current shift expense',22,$3,CURRENT_DATE,'cash','posted',$4,now()-interval '10 minutes')`,
      [randomUUID(), randomUUID(), ids.branchA, ids.users.cashier],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('starts the live shift-span window at the currently open shift', async () => {
    const { rows } = await client.query<{ w: Record<string, unknown> }>(
      `SELECT public._resolve_business_day_window($1,$2::date) AS w`,
      [ids.branchA, businessDate],
    );
    const w = rows[0].w;
    expect(w.current_shift_only).toBe(true);
    expect(String(w.active_shift_id)).toBe(activeShiftId);

    const resolvedStart = Date.parse(String(w.start_at));
    const expectedStart = Date.parse(activeOpenedAt);
    expect(Math.abs(resolvedStart - expectedStart)).toBeLessThan(1000);
  });

  it('keeps previous-shift expenses out of the live current-day report', async () => {
    const { rows } = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public._build_day_closing_report($1,$2::date) AS r`,
      [ids.branchA, businessDate],
    );
    const details = (rows[0].r.expense_details || []) as Array<{ description: string; amount: number }>;
    expect(details.some((x) => x.description === 'previous shift expense')).toBe(false);
    expect(details.some((x) => x.description === 'current shift expense' && Number(x.amount) === 22)).toBe(true);
  });
});
