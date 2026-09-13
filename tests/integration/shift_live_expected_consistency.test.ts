import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('shift live expected cash consistency', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const userId = randomUUID();

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches (id,name) VALUES ($1,'QA Shift Live')`, [branchId]);
    await client.query(
      `UPDATE public.roles
       SET permissions = COALESCE(permissions, '[]'::jsonb) || '["shifts.close"]'::jsonb
       WHERE role = 'branch_manager'`,
    );
    await client.query(`SELECT set_config('app.register_branch', 'on', true)`);
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Live Shift User','branch_manager',$3,true)`,
      [userId, `${userId}@test.local`, branchId],
    );
    await client.query(`SELECT set_config('app.register_branch', 'off', true)`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('returns the same expected drawer amount before close and at close', async () => {
    const shiftId = (
      await client.query<{ id: string }>(
        `INSERT INTO public.shifts (branch_id,cashier_id,opening_amount,status)
         VALUES ($1,$2,100,'open') RETURNING id`,
        [branchId, userId],
      )
    ).rows[0].id;

    await client.query(
      `INSERT INTO public.shift_operations
        (shift_id,operation_type,amount,payment_method,reference_type,created_by)
       VALUES
        ($1,'sale',120,'cash','sale',$2),
        ($1,'sale',50,'card','sale',$2),
        ($1,'cash_in',30,'cash','manual',$2),
        ($1,'refund',10,'cash','refund',$2),
        ($1,'expense',20,'cash','expense',$2),
        ($1,'cash_out',5,'cash','manual',$2)`,
      [shiftId, userId],
    );

    const active = await asUser(() =>
      client.query<{ r: { success?: boolean; open?: boolean; shift?: { id?: string; expected?: number; cash_sales?: number; cash_in?: number; cash_out?: number; total_sales?: number } } }>(
        `SELECT public.get_active_shift($1) AS r`,
        [branchId],
      ),
    );

    expect(active.rows[0].r).toMatchObject({ success: true, open: true });
    expect(active.rows[0].r.shift?.id).toBe(shiftId);
    expect(Number(active.rows[0].r.shift?.expected)).toBe(215);
    expect(Number(active.rows[0].r.shift?.cash_sales)).toBe(120);
    expect(Number(active.rows[0].r.shift?.cash_in)).toBe(30);
    expect(Number(active.rows[0].r.shift?.cash_out)).toBe(35);
    expect(Number(active.rows[0].r.shift?.total_sales)).toBe(170);

    const closed = await asUser(() =>
      client.query<{ r: { success?: boolean; expected?: number; actual?: number; difference?: number } }>(
        `SELECT public.close_shift($1,215,'numeric consistency') AS r`,
        [shiftId],
      ),
    );

    expect(closed.rows[0].r).toMatchObject({ success: true });
    expect(Number(closed.rows[0].r.expected)).toBe(215);
    expect(Number(closed.rows[0].r.actual)).toBe(215);
    expect(Number(closed.rows[0].r.difference)).toBe(0);

    const stored = await client.query<{ expected_amount: number; actual_amount: number; difference: number; status: string }>(
      `SELECT expected_amount,actual_amount,difference,status FROM public.shifts WHERE id=$1`,
      [shiftId],
    );
    expect(stored.rows[0].status).toBe('closed');
    expect(Number(stored.rows[0].expected_amount)).toBe(215);
    expect(Number(stored.rows[0].actual_amount)).toBe(215);
    expect(Number(stored.rows[0].difference)).toBe(0);
  });
});