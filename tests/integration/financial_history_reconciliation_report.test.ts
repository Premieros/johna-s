import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('reconciliation report historical sales visibility', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonation = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonation = await canImpersonate(client);
    if (!impersonation) return;

    // Grant the SAME reporting capability to both users. Only the dedicated
    // history permission may explain the historical difference.
    await client.query(`
      UPDATE public.roles
      SET permissions = permissions || '["reports.costing"]'::jsonb
      WHERE role = 'cashier'
    `);
    await client.query(`
      UPDATE public.roles
      SET permissions = permissions || '["reports.costing","history.unlimited"]'::jsonb
      WHERE role = 'branch_manager'
    `);
    await client.query(`
      UPDATE private.financial_visibility_settings
      SET recent_days = 3, historical_percent = 0
      WHERE singleton = true
    `);

    for (const [label, days] of [['OLD', 30], ['RECENT', 1]] as const) {
      const saleId = randomUUID();
      await client.query(
        `INSERT INTO public.sales
          (id,invoice_number,branch_id,warehouse_id,subtotal,discount_amount,tax_amount,total,
           paid_amount,payment_method,status,created_at)
         VALUES ($1,$2,$3,$4,100,0,0,100,100,'cash','completed',
                 now() - ($5::int * interval '1 day'))`,
        [saleId, `HISTORY-RPC-${label}-${saleId.slice(0,8)}`, ids.branchA, ids.whA, days],
      );
    }
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('excludes hidden historical sales from net_sales while retaining all recent sales', async (ctx) => {
    if (!impersonation) return ctx.skip();
    const query = `SELECT public.get_sales_component_reconciliation_report(
      $1::uuid, (current_date - interval '35 days')::date, (current_date + interval '1 day')::date
    ) AS result`;
    const limited = await runAs(client, ids.users.cashier, query, [ids.branchA]);
    const unlimited = await runAs(client, ids.users.branch_manager, query, [ids.branchA]);

    expect(limited.error).toBeUndefined();
    expect(unlimited.error).toBeUndefined();
    expect(Number((limited.rows[0].result as {summary: {net_sales: number}}).summary.net_sales)).toBe(100);
    expect(Number((unlimited.rows[0].result as {summary: {net_sales: number}}).summary.net_sales)).toBe(200);
  });

  it('limits settlement and financial reconciliation totals to visible sales', async (ctx) => {
    if (!impersonation) return ctx.skip();
    const from = new Date(Date.now() - 35 * 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    const paymentSql = `SELECT public.get_sales_by_payment_report(
      $1::uuid,$2::timestamptz,$3::timestamptz
    ) AS result`;
    const financeSql = `SELECT public.get_financial_reconciliation_report(
      $1::uuid,$2::timestamptz,$3::timestamptz
    ) AS result`;

    for (const sql of [paymentSql, financeSql]) {
      const limited = await runAs(client, ids.users.cashier, sql, [ids.branchA, from, to]);
      const unlimited = await runAs(client, ids.users.branch_manager, sql, [ids.branchA, from, to]);
      expect(limited.error).toBeUndefined();
      expect(unlimited.error).toBeUndefined();
      const limitedResult = limited.rows[0].result as {success: boolean; summary: {invoice_count: number; net_sales?: number; sales_total?: number}};
      const fullResult = unlimited.rows[0].result as typeof limitedResult;
      expect(limitedResult.success).toBe(true);
      expect(fullResult.success).toBe(true);
      expect(limitedResult.summary.invoice_count).toBe(1);
      expect(fullResult.summary.invoice_count).toBe(2);
      const limitedSales = limitedResult.summary.net_sales ?? limitedResult.summary.sales_total;
      const fullSales = fullResult.summary.net_sales ?? fullResult.summary.sales_total;
      expect(Number(limitedSales)).toBe(100);
      expect(Number(fullSales)).toBe(200);
    }
  });

  it('prevents direct reads of old closed-day snapshots', async (ctx) => {
    if (!impersonation) return ctx.skip();
    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10);
    const recentDate = new Date().toISOString().slice(0,10);
    await client.query(
      `INSERT INTO public.daily_closes (branch_id,business_date,report_snapshot)
       VALUES ($1,$2::date,'{"net_sales":99999}'::jsonb),
              ($1,$3::date,'{"net_sales":100}'::jsonb)`,
      [ids.branchA, oldDate, recentDate],
    );
    const sql = `SELECT business_date::text FROM public.daily_closes
      WHERE branch_id=$1 ORDER BY business_date`;
    const limited = await runAs(client, ids.users.cashier, sql, [ids.branchA]);
    const unlimited = await runAs(client, ids.users.branch_manager, sql, [ids.branchA]);
    expect(limited.error).toBeUndefined();
    expect(unlimited.error).toBeUndefined();
    expect(limited.rows).toHaveLength(1);
    expect(unlimited.rows).toHaveLength(2);

    const denied = await runAs(client, ids.users.cashier,
      'SELECT public.get_day_closing_report($1::uuid,$2::date) AS result',
      [ids.branchA, oldDate]);
    expect(denied.error).toBeUndefined();
    expect(denied.rows[0].result).toMatchObject({
      success: false, error: 'HISTORY_PERMISSION_DENIED',
    });
  });

  it('does not provide full older shift summaries to limited users', async (ctx) => {
    if (!impersonation) return ctx.skip();
    await client.query(
      `UPDATE public.shifts SET opened_at=now()-interval '30 days'
       WHERE id=$1`, [ids.shiftA],
    );
    const denied = await runAs(client, ids.users.cashier,
      'SELECT public.get_shift_closing_report($1::uuid) AS result',
      [ids.shiftA]);
    expect(denied.error).toBeUndefined();
    expect(denied.rows[0].result).toMatchObject({
      success: false, error: 'HISTORY_PERMISSION_DENIED',
    });
  });

  it('rejects cross-branch reconciliation reads', async (ctx) => {
    if (!impersonation) return ctx.skip();
    const result = await runAs(client, ids.users.cashier,
      `SELECT public.get_sales_component_reconciliation_report(
        $1::uuid, (current_date - interval '35 days')::date, current_date
      ) AS result`, [ids.branchB]);
    expect(result.error).toBeDefined();
  });
});
