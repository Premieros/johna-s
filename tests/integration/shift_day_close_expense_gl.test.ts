import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
type RpcPayload = {
  success?: boolean;
  error?: string;
  expense_id?: string;
  already_posted?: boolean;
  already_reversed?: boolean;
  day_close?: { success?: boolean };
};

describe.skipIf(!dbUrl)('shift/day close and expense GL contract', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let expenseAccountId = '';
  let treasuryBranchCashA = '';
  let impersonationAvailable = false;
  const expenseKey = `expense-${randomUUID()}`;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);
    const account = await client.query<{ id: string }>(
      `SELECT id FROM public.chart_of_accounts WHERE branch_id = $1 AND account_type = 'expense' AND is_active LIMIT 1`,
      [ids.branchA],
    );
    expenseAccountId = account.rows[0]?.id || '';
    const branchCash = await client.query<{ id: string }>(
      `SELECT id
       FROM public.treasury_accounts
       WHERE branch_id = $1
         AND COALESCE(scope, 'branch') = 'branch'
         AND COALESCE(kind, CASE WHEN account_type = 'bank' THEN 'bank' ELSE 'branch_cash' END) = 'branch_cash'
         AND is_active
       ORDER BY is_primary DESC, created_at
       LIMIT 1`,
      [ids.branchA],
    );
    treasuryBranchCashA = branchCash.rows[0]?.id || '';
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('posts one balanced expense and retries idempotently', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    expect(expenseAccountId).toBeTruthy();

    const expectedBefore = await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [ids.shiftA],
    );

    const params = [
      expenseKey, ids.branchA, ids.shiftA, 'supplies', 'Test supplies', 25, 'cash',
      expenseAccountId, ids.treasuryBankA, new Date().toISOString().slice(0, 10), 'integration',
    ];
    const first = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.post_shift_expense($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS r`,
      params,
    );
    expect(first.error).toBeUndefined();
    const firstResult = first.rows[0].r as RpcPayload;
    expect(firstResult.success).toBe(true);
    const expenseId = String(firstResult.expense_id);

    const retry = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.post_shift_expense($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS r`,
      params,
    );
    expect(retry.rows[0].r).toMatchObject({ success: true, already_posted: true, expense_id: expenseId });

    const counts = await client.query<{ expenses: number; journals: number; debits: string; credits: string }>(
      `SELECT
         (SELECT count(*)::int FROM public.expenses WHERE id = $1) AS expenses,
         (SELECT count(*)::int FROM public.journal_entries WHERE reference_type = 'expense' AND reference_id = $1) AS journals,
         (SELECT COALESCE(sum(l.debit),0)::text FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE j.reference_type='expense' AND j.reference_id=$1) AS debits,
         (SELECT COALESCE(sum(l.credit),0)::text FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE j.reference_type='expense' AND j.reference_id=$1) AS credits`,
      [expenseId],
    );
    expect(counts.rows[0]).toMatchObject({ expenses: 1, journals: 1, debits: '25.00', credits: '25.00' });

    const bankDrawerRows = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.shift_operations
       WHERE reference_type = 'expense' AND reference_id = $1`,
      [expenseId],
    );
    expect(bankDrawerRows.rows[0]?.count).toBe(0);

    const expectedAfterBank = await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [ids.shiftA],
    );
    expect(expectedAfterBank.rows[0]?.amount).toBe(expectedBefore.rows[0]?.amount);
  });

  it('deducts only same-branch branch_cash expenses from the shift drawer', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    expect(treasuryBranchCashA).toBeTruthy();

    const before = await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [ids.shiftA],
    );

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.post_shift_expense($1,$2,$3,'supplies','Branch cash expense',30,'cash',$4,$5,CURRENT_DATE,'integration') AS r`,
      [`branch-cash-${randomUUID()}`, ids.branchA, ids.shiftA, expenseAccountId, treasuryBranchCashA],
    );
    expect(result.error).toBeUndefined();
    const payload = result.rows[0].r as RpcPayload & { affects_shift_cash?: boolean };
    expect(payload).toMatchObject({ success: true, affects_shift_cash: true });
    const expenseId = String(payload.expense_id);

    const drawerRows = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.shift_operations
       WHERE reference_type = 'expense' AND reference_id = $1 AND operation_type = 'expense'`,
      [expenseId],
    );
    expect(drawerRows.rows[0]?.count).toBe(1);

    const after = await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [ids.shiftA],
    );
    expect(Number(after.rows[0]?.amount)).toBeCloseTo(Number(before.rows[0]?.amount) - 30, 2);
  });

  it('reverses an expense once and preserves the original posting', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const expense = await client.query<{ id: string }>(
      `SELECT id FROM public.expenses WHERE idempotency_key = $1`,
      [expenseKey],
    );
    const expenseId = expense.rows[0].id;
    const first = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.reverse_shift_expense($1,'integration reversal') AS r`, [expenseId]);
    expect(first.rows[0].r).toMatchObject({ success: true, already_reversed: false });

    const retry = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.reverse_shift_expense($1,'integration reversal') AS r`, [expenseId]);
    expect(retry.rows[0].r).toMatchObject({ success: true, already_reversed: true });

    const rows = await client.query<{ status: string; entries: number }>(
      `SELECT e.status,
        (SELECT count(*)::int FROM public.journal_entries j WHERE j.reference_type='expense_reversal' AND j.reference_id=e.id) AS entries
       FROM public.expenses e WHERE e.id=$1`,
      [expenseId],
    );
    expect(rows.rows[0]).toEqual({ status: 'voided', entries: 1 });

    const reversalDrawerRows = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.shift_operations
       WHERE reference_type = 'expense_reversal' AND reference_id = $1`,
      [expenseId],
    );
    expect(reversalDrawerRows.rows[0]?.count).toBe(0);
  });

  it('blocks cross-branch expense posting for a branch user', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const result = await runAsPersist(client, ids.users.branch_manager,
      `SELECT public.post_shift_expense($1,$2,$3,'other','Cross branch',10,'cash',$4,$5,CURRENT_DATE,NULL) AS r`,
      [`cross-${randomUUID()}`, ids.branchB, ids.shiftB, expenseAccountId, ids.treasuryBankB]);
    expect(result.rows[0].r).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });

  it('blocks close with open orders, then closes and retries idempotently', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const orderId = randomUUID();
    await client.query(
      `INSERT INTO public.orders(id,order_number,branch_id,order_type,status,subtotal,discount_amount,tax_amount,total,payment_status)
       VALUES ($1,$2,$3,'takeaway','open',0,0,0,0,'unpaid')`,
      [orderId, `CLOSE-${randomUUID()}`, ids.branchA],
    );

    const blocked = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.close_shift($1,0,'blocked') AS r`, [ids.shiftA]);
    expect(blocked.rows[0].r).toMatchObject({ success: false, error: 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE' });

    await client.query(`UPDATE public.orders SET status='completed', payment_status='paid' WHERE branch_id=$1 AND status IN ('open','held')`, [ids.branchA]);
    const closed = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.close_shift($1,0,'closed') AS r`, [ids.shiftA]);
    const closedResult = closed.rows[0].r as RpcPayload;
    expect(closedResult.success, JSON.stringify(closedResult)).toBe(true);

    const dayClosed = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.day_close($1,CURRENT_DATE) AS r`, [ids.branchA]);
    expect(dayClosed.rows[0].r).toMatchObject({ success: true, already_closed: false });

    const beforeRetry = await client.query(
      `SELECT status, closed_at, expected_amount, actual_amount, difference
       FROM public.shifts WHERE id = $1`,
      [ids.shiftA],
    );
    const retry = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.close_shift($1,0,'retry') AS r`, [ids.shiftA]);
    expect(retry.rows[0].r).toMatchObject({ success: false, error: 'SHIFT_CLOSED' });
    const afterRetry = await client.query(
      `SELECT status, closed_at, expected_amount, actual_amount, difference
       FROM public.shifts WHERE id = $1`,
      [ids.shiftA],
    );
    expect(afterRetry.rows).toEqual(beforeRetry.rows);

    const day = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.day_close($1,CURRENT_DATE) AS r`, [ids.branchA]);
    expect(day.rows[0].r).toMatchObject({ success: true, already_closed: true });
  });
});