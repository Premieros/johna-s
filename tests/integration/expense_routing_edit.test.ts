import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('expense routing and safe edit contract', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let expenseAccountId = '';
  let branchCashId = '';
  let impersonationAvailable = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    expenseAccountId = (await client.query<{ id: string }>(
      `SELECT id FROM public.chart_of_accounts
       WHERE branch_id=$1 AND account_type='expense' AND is_active
       ORDER BY code LIMIT 1`,
      [ids.branchA],
    )).rows[0]?.id || '';

    branchCashId = (await client.query<{ id: string }>(
      `SELECT id FROM public.treasury_accounts
       WHERE branch_id=$1
         AND COALESCE(kind, CASE WHEN account_type='bank' THEN 'bank' ELSE 'branch_cash' END)='branch_cash'
         AND is_active
       ORDER BY is_primary DESC, created_at
       LIMIT 1`,
      [ids.branchA],
    )).rows[0]?.id || '';
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('stores routing without rewriting historical expenses', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const historicalCount = Number((await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.expenses WHERE branch_id=$1`,
      [ids.branchA],
    )).rows[0]?.c || 0);

    const saved = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.upsert_expense_routing_rule($1,'maintenance',$2,$3,'cash',true) AS r`,
      [ids.branchA, expenseAccountId, branchCashId],
    );
    expect(saved.error).toBeUndefined();
    expect(saved.rows[0].r).toMatchObject({ success: true });

    const listed = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT * FROM public.get_expense_routing_rules($1) WHERE category='maintenance'`,
      [ids.branchA],
    );
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]).toMatchObject({
      category: 'maintenance',
      expense_account_id: expenseAccountId,
      treasury_account_id: branchCashId,
      payment_method: 'cash',
      is_active: true,
    });

    const afterCount = Number((await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.expenses WHERE branch_id=$1`,
      [ids.branchA],
    )).rows[0]?.c || 0);
    expect(afterCount).toBe(historicalCount);
  });

  it('edits by reversal + replacement and preserves report/drawer truth', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const expectedBefore = Number((await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [ids.shiftA],
    )).rows[0]?.amount || 0);

    const posted = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.post_shift_expense($1,$2,$3,'maintenance','Old amount',40,'cash',$4,$5,CURRENT_DATE,'before edit') AS r`,
      [`expense-edit-${randomUUID()}`, ids.branchA, ids.shiftA, expenseAccountId, branchCashId],
    );
    expect(posted.error).toBeUndefined();
    expect(posted.rows[0].r).toMatchObject({ success: true });
    const oldId = String((posted.rows[0].r as { expense_id: string }).expense_id);

    const edited = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.edit_shift_expense(
        $1,$2,'maintenance','Corrected amount',15,'cash',$3,$4,CURRENT_DATE,'after edit','amount correction'
      ) AS r`,
      [oldId, `expense-replacement-${randomUUID()}`, expenseAccountId, branchCashId],
    );
    expect(edited.error).toBeUndefined();
    expect(edited.rows[0].r).toMatchObject({ success: true, old_expense_id: oldId });
    const replacementId = String((edited.rows[0].r as { replacement_expense_id: string }).replacement_expense_id);
    expect(replacementId).toBeTruthy();
    expect(replacementId).not.toBe(oldId);

    const rows = await client.query<{ id: string; status: string; amount: string }>(
      `SELECT id,status,amount::text
       FROM public.expenses
       WHERE id=ANY($1::uuid[])
       ORDER BY id`,
      [[oldId, replacementId]],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    expect(byId.get(oldId)).toMatchObject({ status: 'voided', amount: '40.00' });
    expect(byId.get(replacementId)).toMatchObject({ status: 'posted', amount: '15.00' });

    const drawerNet = Number((await client.query<{ net: string }>(
      `SELECT COALESCE(sum(CASE
         WHEN operation_type='cash_in' THEN amount
         WHEN operation_type='expense' THEN -amount
         ELSE 0 END),0)::text AS net
       FROM public.shift_operations
       WHERE (reference_type='expense' AND reference_id=ANY($1::uuid[]))
          OR (reference_type='expense_reversal' AND reference_id=$2)`,
      [[oldId, replacementId], oldId],
    )).rows[0]?.net || 0);
    expect(drawerNet).toBeCloseTo(-15, 2);

    const expectedAfter = Number((await client.query<{ amount: string }>(
      `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
      [ids.shiftA],
    )).rows[0]?.amount || 0);
    expect(expectedAfter).toBeCloseTo(expectedBefore - 15, 2);

    const postedTotal = Number((await client.query<{ total: string }>(
      `SELECT COALESCE(sum(amount),0)::text AS total
       FROM public.expenses
       WHERE id=ANY($1::uuid[]) AND status='posted'`,
      [[oldId, replacementId]],
    )).rows[0]?.total || 0);
    expect(postedTotal).toBeCloseTo(15, 2);
  });

  it('blocks editing a closed shift expense', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const posted = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.post_shift_expense($1,$2,$3,'other','Close guard',5,'cash',$4,$5,CURRENT_DATE,NULL) AS r`,
      [`closed-edit-${randomUUID()}`, ids.branchA, ids.shiftA, expenseAccountId, branchCashId],
    );
    const expenseId = String((posted.rows[0].r as { expense_id: string }).expense_id);

    await client.query(`UPDATE public.shifts SET status='closed', closed_at=now() WHERE id=$1`, [ids.shiftA]);

    const edited = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.edit_shift_expense(
        $1,$2,'other','Should block',7,'cash',$3,$4,CURRENT_DATE,NULL,'closed period edit'
      ) AS r`,
      [expenseId, `closed-edit-replacement-${randomUUID()}`, expenseAccountId, branchCashId],
    );
    expect(edited.rows[0].r).toMatchObject({ success: false, error: 'CLOSED_SHIFT_EXPENSE_EDIT_BLOCKED' });
  });
});
