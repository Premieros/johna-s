import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('shift zero opening and negative close', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const userId = randomUUID();
  const role = `qa_negative_shift_${randomUUID().slice(0, 8)}`;
  const shiftId = randomUUID();

  async function asUser(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await client.query(sql, params);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'QA Negative Shift')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'وردية سالبة','Negative shift','["shifts.open","shifts.close"]'::jsonb,'global',true)`,
      [role],
    );
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Negative Shift User',$3,$4,true)`,
      [userId, `${userId}@test.local`, role, branchId],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('open_shift ignores a non-zero requested opening and persists zero', async () => {
    const opened = await asUser(
      `SELECT public.open_shift($1,999,'must be zero') AS r`,
      [branchId],
    );
    expect(opened.rows[0].r).toMatchObject({ success: true, opening_amount: 0 });
    const createdId = opened.rows[0].r.shift_id as string;

    const row = await client.query<{ opening_amount: string }>(
      'SELECT opening_amount::text FROM public.shifts WHERE id=$1',
      [createdId],
    );
    expect(row.rows[0].opening_amount).toBe('0.00');

    await client.query('DELETE FROM public.shift_operations WHERE shift_id=$1', [createdId]);
    await client.query('DELETE FROM public.shifts WHERE id=$1', [createdId]);
  });

  it('closes a zero-opening shift with a negative expected and actual balance', async () => {
    await client.query(
      `INSERT INTO public.shifts(id,branch_id,cashier_id,opening_amount,status)
       VALUES ($1,$2,$3,0,'open')`,
      [shiftId, branchId, userId],
    );
    await client.query(
      `INSERT INTO public.shift_operations(
         shift_id,operation_type,amount,payment_method,reference_type,created_by
       ) VALUES ($1,'cash_out',25,'cash','qa_negative_close',$2)`,
      [shiftId, userId],
    );

    const expected = await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [shiftId],
    );
    expect(expected.rows[0].amount).toBe('-25.00');

    const closed = await asUser(
      `SELECT public.close_shift($1,-25,'negative is valid') AS r`,
      [shiftId],
    );
    expect(closed.rows[0].r).toMatchObject({
      success: true,
      shift_id: shiftId,
      expected: -25,
      actual: -25,
      difference: 0,
    });

    const row = await client.query<{
      status: string;
      opening_amount: string;
      expected_amount: string;
      actual_amount: string;
      difference: string;
    }>(
      `SELECT status,opening_amount::text,expected_amount::text,actual_amount::text,difference::text
         FROM public.shifts WHERE id=$1`,
      [shiftId],
    );
    expect(row.rows[0]).toEqual({
      status: 'closed',
      opening_amount: '0.00',
      expected_amount: '-25.00',
      actual_amount: '-25.00',
      difference: '0.00',
    });
  });
});
