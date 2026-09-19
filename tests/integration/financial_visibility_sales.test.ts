import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

function sortedIds(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.id)).sort();
}

describe.skipIf(skip)('financial sales visibility', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  const oldSaleIds: string[] = [];
  const recentSaleIds: string[] = [];
  let visibleOldSaleId = '';
  let hiddenOldSaleId = '';
  let visibleItemId = '';
  let hiddenItemId = '';
  let otherBranchVisibleBucketSaleId = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    // Seed old sales to prove authorized branch users receive complete history.
    for (let i = 0; i < 60; i += 1) {
      const saleId = randomUUID();
      oldSaleIds.push(saleId);
      await client.query(
        `INSERT INTO public.sales
          (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
         VALUES ($1, $2, $3, $4, 20, 0, 0, 20, 20, 'cash', 'completed', now() - interval '30 days')`,
        [saleId, `FV-OLD-${i}-${saleId.slice(0, 8)}`, ids.branchA, ids.whA],
      );
    }

    visibleOldSaleId = oldSaleIds[0];
    hiddenOldSaleId = oldSaleIds[1];

    for (let i = 0; i < 3; i += 1) {
      const saleId = randomUUID();
      recentSaleIds.push(saleId);
      await client.query(
        `INSERT INTO public.sales
          (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
         VALUES ($1, $2, $3, $4, 20, 0, 0, 20, 20, 'cash', 'completed', now() - interval '1 day')`,
        [saleId, `FV-RECENT-${i}-${saleId.slice(0, 8)}`, ids.branchA, ids.whA],
      );
    }

    visibleItemId = randomUUID();
    hiddenItemId = randomUUID();
    await client.query(
      `INSERT INTO public.sale_items (id, sale_id, product_id, unit_name, quantity, unit_price, total)
       VALUES
         ($1, $2, $3, 'piece', 1, 20, 20),
         ($4, $5, $3, 'piece', 1, 20, 20)`,
      [visibleItemId, visibleOldSaleId, ids.prodA, hiddenItemId, hiddenOldSaleId],
    );

    // A branch-B old sale must remain invisible to branch-A staff.
    otherBranchVisibleBucketSaleId = randomUUID();

    await client.query(
      `INSERT INTO public.sales
        (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, 20, 0, 0, 20, 20, 'cash', 'completed', now() - interval '30 days')`,
      [otherBranchVisibleBucketSaleId, `FV-OTHER-${otherBranchVisibleBucketSaleId.slice(0, 8)}`, ids.branchB, ids.whB],
    );
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

  guarded('owner sees all accessible old sales', async () => {
    const result = await runAs(
      client,
      ids.users.owner,
      'SELECT id FROM public.sales WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldSaleIds],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual([...oldSaleIds].sort());
  });

  guarded('non-owner sees all sales from the last seven days', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.sales WHERE id = ANY($1::uuid[]) ORDER BY id',
      [recentSaleIds],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual([...recentSaleIds].sort());
  });

  guarded('authorized non-owner users see complete old history for their branch', async () => {
    const cashier = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.sales WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldSaleIds],
    );
    const manager = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT id FROM public.sales WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldSaleIds],
    );

    expect(cashier.error).toBeUndefined();
    expect(manager.error).toBeUndefined();
    expect(sortedIds(cashier.rows)).toEqual([...oldSaleIds].sort());
    expect(sortedIds(manager.rows)).toEqual([...oldSaleIds].sort());
  });

  guarded('super_admin sees complete accessible old history', async () => {
    const result = await runAs(
      client,
      ids.users.super_admin,
      'SELECT id FROM public.sales WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldSaleIds],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual([...oldSaleIds].sort());
  });

  guarded('branch isolation still rejects another branch for old history', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.sales WHERE id = $1',
      [otherBranchVisibleBucketSaleId],
    );
    expect(result.error).toBeUndefined();
    expect(result.rowCount).toBe(0);
  });

  guarded('sale_items remain complete when their parent sales are authorized', async () => {
    const restricted = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.sale_items WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visibleItemId, hiddenItemId]],
    );
    const owner = await runAs(
      client,
      ids.users.owner,
      'SELECT id FROM public.sale_items WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visibleItemId, hiddenItemId]],
    );

    expect(restricted.error).toBeUndefined();
    expect(sortedIds(restricted.rows)).toEqual([hiddenItemId, visibleItemId].sort());
    expect(owner.error).toBeUndefined();
    expect(sortedIds(owner.rows)).toEqual([hiddenItemId, visibleItemId].sort());
  });

  guarded('financial visibility policies are restrictive and cannot OR around branch policies', async () => {
    const result = await client.query<{ tablename: string; policyname: string; permissive: string }>(
      `SELECT tablename, policyname, permissive
       FROM pg_policies
       WHERE schemaname = 'public'
         AND policyname IN ('financial_visibility_sales', 'financial_visibility_sale_items')
       ORDER BY tablename`,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.permissive === 'RESTRICTIVE')).toBe(true);
  });
});
