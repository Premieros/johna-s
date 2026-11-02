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

  guarded('builds a read-only report row with correct period opening, debit, paid and closing totals', async () => {
    const openingId = randomUUID();
    const saleId = randomUUID();
    const entryNumber = `EMP-REPORT-${saleId.slice(0, 8)}`;
    const dates = await client.query(
      `SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS today,
              date_trunc('month', now() AT TIME ZONE 'Africa/Cairo')::date AS month_start`,
    );
    const today = String(dates.rows[0].today);
    const monthStart = String(dates.rows[0].month_start);

    await client.query(
      `INSERT INTO public.employee_receivable_entries
        (id, branch_id, customer_id, occurred_at, reference_number, entry_type, amount, notes)
       VALUES ($1,$2,$3,now() - interval '40 days','EMP-REPORT-OPEN','opening_balance',125,'report fixture')`,
      [openingId, ids.branchA, ids.custA],
    );
    await client.query(
      `INSERT INTO public.sales
        (id, invoice_number, customer_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES ($1,$2,$3,$4,$5,75,0,0,75,0,'credit','completed',now())`,
      [saleId, entryNumber, ids.custA, ids.branchA, ids.whA],
    );
    const journalEntryId = randomUUID();
    await client.query(
      `INSERT INTO public.journal_entries
        (id, entry_number, branch_id, entry_date, reference_type, reference_id, reference_number, description)
       VALUES ($1,$2,$3,$4,'sale',$5,$2,'Employee report fixture sale')`,
      [journalEntryId, entryNumber, ids.branchA, monthStart, saleId],
    );
    await client.query(
      `INSERT INTO public.journal_entry_lines
        (journal_entry_id, account_id, debit, credit, customer_id, note)
       VALUES ($1,$2,75,0,$3,'Employee report fixture sale')`,
      [journalEntryId, ids.coaPoolA[0], ids.custA],
    );

    const payment = await runAsPersist(
      client,
      ids.users.branch_manager,
      `SELECT public.receive_employee_receivable_payment($1,$2,10,'cash',NULL,'employee report fixture payment') AS result`,
      [ids.custA, ids.branchA],
    );
    expect(payment.error).toBeUndefined();
    expect(payment.rows[0]?.result).toMatchObject({ success: true, open_before: 200, open_after: 190 });

    const report = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_employee_receivables_period_summary($1,$2,$3) AS result`,
      [ids.branchA, monthStart, today],
    );
    expect(report.error).toBeUndefined();
    const rows = (report.rows[0]?.result || []) as Array<Record<string, unknown>>;
    const employee = rows.find((row) => row.customer_id === ids.custA);
    expect(employee).toBeTruthy();
    expect(Number(employee?.period_opening_balance)).toBe(125);
    expect(Number(employee?.period_debit)).toBe(75);
    expect(Number(employee?.period_credit)).toBe(10);
    expect(Number(employee?.period_closing_balance)).toBe(190);

    const branchDenied = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_employee_receivables_period_summary($1,$2,$3) AS result`,
      [ids.branchB, monthStart, today],
    );
    expect(branchDenied.error).toContain('BRANCH_MISMATCH');

    const permissionDenied = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.get_employee_receivables_period_summary($1,$2,$3) AS result`,
      [ids.branchA, monthStart, today],
    );
    expect(permissionDenied.error).toContain('PERMISSION_DENIED:accounts.view');

    const invalidPeriod = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.get_employee_receivables_period_summary($1,$2,$3) AS result`,
      [ids.branchA, today, monthStart],
    );
    expect(invalidPeriod.error).toContain('EMPLOYEE_RECEIVABLE_PERIOD_INVALID');
  });

});
