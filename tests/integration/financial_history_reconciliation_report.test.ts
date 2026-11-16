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

  it('rejects cross-branch reconciliation reads', async (ctx) => {
    if (!impersonation) return ctx.skip();
    const result = await runAs(client, ids.users.cashier,
      `SELECT public.get_sales_component_reconciliation_report(
        $1::uuid, (current_date - interval '35 days')::date, current_date
      ) AS result`, [ids.branchB]);
    expect(result.error).toBeDefined();
  });
});
