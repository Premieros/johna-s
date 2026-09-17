import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('shift live expected cash consistency', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    // The shared RLS fixture intentionally carries an open order for policy probes.
    // Settle that unrelated row so this test stays focused on drawer math consistency.
    await client.query(
      `UPDATE public.orders
          SET payment_status = 'paid', payment_at = now()
        WHERE id = $1`,
      [ids.rows.orders.own],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('returns the same expected drawer amount before close and at close', async () => {
    const shiftId = ids.shiftA;
    const userId = ids.users.cashier;
    const branchId = ids.branchA;

    await client.query(
      `UPDATE public.shifts
       SET opening_amount = 100,
           expected_amount = 100,
           actual_amount = 0,
           difference = 0,
           status = 'open',
           closed_at = NULL
       WHERE id = $1`,
      [shiftId],
    );

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

    const active = await runAsPersist(
      client,
      userId,
      `SELECT public.get_active_shift($1) AS r`,
      [branchId],
    );
    if (active.error) throw new Error(active.error);
    const activeResult = active.rows[0]?.r as {
      success?: boolean;
      open?: boolean;
      shift?: {
        id?: string;
        expected?: number;
        cash_sales?: number;
        cash_in?: number;
        cash_out?: number;
        total_sales?: number;
      };
    };

    expect(activeResult).toMatchObject({ success: true, open: true });
    expect(activeResult.shift?.id).toBe(shiftId);
    expect(Number(activeResult.shift?.expected)).toBe(215);
    expect(Number(activeResult.shift?.cash_sales)).toBe(120);
    expect(Number(activeResult.shift?.cash_in)).toBe(30);
    expect(Number(activeResult.shift?.cash_out)).toBe(35);
    expect(Number(activeResult.shift?.total_sales)).toBe(170);

    await client.query(
      `UPDATE public.orders SET status = 'completed', payment_status = 'paid'
       WHERE branch_id = $1 AND status IN ('open', 'held')`,
      [branchId],
    );

    const closed = await runAsPersist(
      client,
      userId,
      `SELECT public.close_shift($1,215,'numeric consistency') AS r`,
      [shiftId],
    );
    if (closed.error) throw new Error(closed.error);
    const closedResult = closed.rows[0]?.r as {
      success?: boolean;
      expected?: number;
      actual?: number;
      difference?: number;
      error?: string;
    };

    expect(closedResult).toMatchObject({ success: true });
    expect(Number(closedResult.expected)).toBe(215);
    expect(Number(closedResult.actual)).toBe(215);
    expect(Number(closedResult.difference)).toBe(0);

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