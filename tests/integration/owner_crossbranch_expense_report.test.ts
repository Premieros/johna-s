import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

// Each fixture and permission change is rolled back. This NEVER connects to
// the restaurant database unless someone explicitly misconfigures getDbUrl.
describe.skipIf(!dbUrl)('owner secondary-branch posted expenses remain RLS protected', () => {
  let client: pg.Client;
  let ids: RlsIds;
  const category = 'OWNER-RPT-' + randomUUID().slice(0, 8);

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    if (!await canImpersonate(client)) throw new Error('Requires isolated CI auth stub');
    ids = await seedRlsFixture(client);

    // Owner with both requested permissions, without a primary-branch switch.
    await client.query(`UPDATE public.roles
      SET permissions = COALESCE(permissions,'[]'::jsonb)
        || '["expenses.view","history.unlimited"]'::jsonb
      WHERE role = 'owner'`);
    await client.query('DELETE FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',
      [ids.users.owner, ids.branchB]);
    await client.query(`INSERT INTO public.expenses
      (branch_id, category, description, amount, expense_date, payment_method, status, account_id)
      VALUES ($1,$3,'owner first branch',21,CURRENT_DATE,'cash','posted',$4),
             ($2,$3,'owner secondary branch',79,CURRENT_DATE,'cash','posted',$5),
             ($2,$3,'excluded void expense',999,CURRENT_DATE,'cash','voided',$5)`,
      [ids.branchA, ids.branchB, category, ids.coaCashA, ids.coaCashB]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  async function expenseAmount(userId: string, branchId: string): Promise<number> {
    const result = await runAs(client, userId,
      `SELECT public.get_operational_report_metrics(
        'expenses',$1,CURRENT_DATE,CURRENT_DATE,$2::jsonb
      ) AS metrics`, [branchId, { category }]);
    expect(result.error).toBeUndefined();
    return Number((result.rows[0].metrics as Record<string, number>)['Amount']);
  }

  it('preserves existing primary-branch access and blocks an ungranted branch', async () => {
    const permissions = await runAs(client, ids.users.owner,
      `SELECT public.can_permission('expenses.view') AS can_view,
              public.can_permission('history.unlimited') AS full_history,
              public.user_may_access_branch($1) AS allowed`, [ids.branchB]);
    expect(permissions.rows[0]).toEqual({can_view:true,full_history:true,allowed:false});
    expect(await expenseAmount(ids.users.owner, ids.branchA)).toBe(21);
    expect(await expenseAmount(ids.users.owner, ids.branchB)).toBe(0);
  });

  it('shows posted expenses on an explicitly granted secondary branch and hides others', async () => {
    await client.query(
      `INSERT INTO public.user_branch_access(user_id,branch_id)
       VALUES($1,$2) ON CONFLICT(user_id,branch_id) DO NOTHING`,
      [ids.users.owner,ids.branchB]);

    const permission = await runAs(client,ids.users.owner,
      'SELECT public.user_may_access_branch($1) AS allowed',[ids.branchB]);
    expect(permission.rows[0].allowed).toBe(true);
    expect(await expenseAmount(ids.users.owner,ids.branchB)).toBe(79);
    expect(await expenseAmount(ids.users.cashier,ids.branchB)).toBe(0);
    expect(await expenseAmount(ids.users.owner,ids.branchA)).toBe(21);

    await client.query('DELETE FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',
      [ids.users.owner,ids.branchB]);
    expect(await expenseAmount(ids.users.owner,ids.branchB)).toBe(0);
  });

  it('keeps the historical financial-visibility policy restrictive', async () => {
    const result = await client.query(
      `SELECT policyname,permissive FROM pg_policies
       WHERE schemaname='public' AND tablename='expenses'
         AND policyname IN ('auth_select_expenses','financial_visibility_expenses')
       ORDER BY policyname`);
    expect(result.rows).toEqual([
      {policyname:'auth_select_expenses',permissive:'PERMISSIVE'},
      {policyname:'financial_visibility_expenses',permissive:'RESTRICTIVE'},
    ]);
  });
});
