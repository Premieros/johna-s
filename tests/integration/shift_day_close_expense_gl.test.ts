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
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('posts one balanced expense and retries idempotently', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    expect(expenseAccountId).toBeTruthy();

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
    expect(blocked.rows[0].r).toMatchObject({ success: false, error: 'OPEN_ORDERS_REMAIN' });

    await client.query(`UPDATE public.orders SET status='completed', payment_status='paid' WHERE branch_id=$1 AND status IN ('open','held')`, [ids.branchA]);
    const closed = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.close_shift($1,0,'closed') AS r`, [ids.shiftA]);
    const closedResult = closed.rows[0].r as RpcPayload;
    expect(closedResult.success, JSON.stringify(closedResult)).toBe(true);
    expect(closedResult.day_close?.success).toBe(true);

    const retry = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.close_shift($1,0,'retry') AS r`, [ids.shiftA]);
    expect(retry.rows[0].r).toMatchObject({ success: true, already_closed: true });

    const day = await runAsPersist(client, ids.users.super_admin,
      `SELECT public.day_close($1,CURRENT_DATE) AS r`, [ids.branchA]);
    expect(day.rows[0].r).toMatchObject({ success: true, already_closed: true });
  });
});