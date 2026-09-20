import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('employee historical receivables', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    await client.query(`
      UPDATE public.roles
      SET permissions = permissions || '["accounts.view","sales.payment.receive"]'::jsonb
      WHERE role = 'branch_manager'
    `);
    await client.query(`UPDATE public.customers SET customer_type = 'employee' WHERE id = $1`, [ids.custA]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx: { skip?: () => unknown }) => {
      if (!imp) return typeof ctx.skip === 'function' ? ctx.skip() : undefined;
      await fn();
    });

  guarded('combines opening/historical debt with future credit sales in all aging views and settles it first through aggregate collection', async () => {
    const historicalId = randomUUID();
    const saleId = randomUUID();

    await client.query(
      `INSERT INTO public.employee_receivable_entries
        (id, branch_id, customer_id, occurred_at, reference_number, entry_type, amount, notes)
       VALUES ($1,$2,$3,now() - interval '40 days','LEGACY-1001','opening_balance',125,'legacy import fixture')`,
      [historicalId, ids.branchA, ids.custA],
    );

    await client.query(
      `INSERT INTO public.sales
        (id, invoice_number, customer_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES ($1,$2,$3,$4,$5,75,0,0,75,0,'credit','completed',now())`,
      [saleId, `EMP-HIST-${saleId.slice(0, 8)}`, ids.custA, ids.branchA, ids.whA],
    );

    const before = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_employee_receivable_balances($1, (now() AT TIME ZONE 'Africa/Cairo')::date) AS result`,
      [ids.branchA],
    );
    expect(before.error).toBeUndefined();
    const rows = (before.rows[0]?.result || []) as Array<Record<string, unknown>>;
    const employee = rows.find((row) => row.customer_id === ids.custA);
    expect(employee).toBeTruthy();
    expect(Number(employee?.open_amount)).toBe(200);
    expect(Number(employee?.bucket_0_30)).toBe(75);
    expect(Number(employee?.bucket_31_60)).toBe(125);

    const aging = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_ar_aging($1, (now() AT TIME ZONE 'Africa/Cairo')::date) AS result`,
      [ids.branchA],
    );
    expect(aging.error).toBeUndefined();
    const agingRows = (aging.rows[0]?.result || []) as Array<Record<string, unknown>>;
    const agingEmployee = agingRows.find((row) => row.customer_id === ids.custA);
    expect(agingEmployee).toBeTruthy();
    expect(Number(agingEmployee?.open_amount)).toBe(200);
    expect(Number(agingEmployee?.bucket_0_30)).toBe(75);
    expect(Number(agingEmployee?.bucket_31_60)).toBe(125);

    const summary = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_aging_summary($1, (now() AT TIME ZONE 'Africa/Cairo')::date) AS result`,
      [ids.branchA],
    );
    expect(summary.error).toBeUndefined();
    const totalFromRows = agingRows.reduce((sum, row) => sum + Number(row.open_amount || 0), 0);
    const summaryResult = (summary.rows[0]?.result || {}) as { ar_open?: number | string };
    expect(Number(summaryResult.ar_open)).toBe(totalFromRows);

    const payment = await runAsPersist(
      client,
      ids.users.branch_manager,
      `SELECT public.receive_payment($1,$2,150,'cash',NULL,'fixture aggregate settlement') AS result`,
      [ids.custA, ids.branchA],
    );
    expect(payment.error).toBeUndefined();
    expect(payment.rows[0]?.result).toMatchObject({ success: true, open_before: 200, open_after: 50 });

    const historical = await client.query(
      `SELECT amount, settled_amount FROM public.employee_receivable_entries WHERE id = $1`,
      [historicalId],
    );
    expect(Number(historical.rows[0]?.amount)).toBe(125);
    expect(Number(historical.rows[0]?.settled_amount)).toBe(125);

    const sale = await client.query(`SELECT paid_amount FROM public.sales WHERE id = $1`, [saleId]);
    expect(Number(sale.rows[0]?.paid_amount)).toBe(25);

    const after = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_employee_receivable_balances($1, (now() AT TIME ZONE 'Africa/Cairo')::date) AS result`,
      [ids.branchA],
    );
    const afterRows = (after.rows[0]?.result || []) as Array<Record<string, unknown>>;
    const afterEmployee = afterRows.find((row) => row.customer_id === ids.custA);
    expect(Number(afterEmployee?.open_amount)).toBe(50);
  });

  guarded('blocks cross-branch settlement', async () => {
    const denied = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.receive_employee_receivable_payment($1,$2,10,'cash',NULL) AS result`,
      [ids.custB, ids.branchB],
    );
    expect(denied.error).toBeUndefined();
    expect(denied.rows[0]?.result).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });
});
