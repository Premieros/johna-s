import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

function visibleOldBucket(branchId: string, orderId: string): boolean {
  const first32 = createHash('md5')
    .update(`${branchId}:${orderId}`)
    .digest('hex')
    .slice(0, 8);
  return Number(BigInt(`0x${first32}`) % 100n) < 30;
}

function sortedIds(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.id)).sort();
}

describe.skipIf(skip)('financial order-history visibility', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  const oldCompletedIds: string[] = [];
  const recentCompletedIds: string[] = [];
  let oldVisibleIds: string[] = [];
  let visibleOldOrderId = '';
  let hiddenOldOrderId = '';
  let hiddenBucketActiveOrderId = '';
  let visibleItemId = '';
  let hiddenItemId = '';
  let otherBranchVisibleBucketOrderId = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    for (let i = 0; i < 60; i += 1) {
      const orderId = randomUUID();
      oldCompletedIds.push(orderId);
      await client.query(
        `INSERT INTO public.orders
          (id, order_number, branch_id, order_type, status, cashier_id, subtotal, discount_amount, tax_amount, total, created_at, completed_at)
         VALUES ($1, $2, $3, 'takeaway', 'completed', $4, 20, 0, 0, 20, now() - interval '30 days', now() - interval '30 days')`,
        [orderId, `FV-ORDER-OLD-${i}-${orderId.slice(0, 8)}`, ids.branchA, ids.users.cashier],
      );
    }

    oldVisibleIds = oldCompletedIds.filter((orderId) => visibleOldBucket(ids.branchA, orderId)).sort();
    visibleOldOrderId = oldCompletedIds.find((orderId) => visibleOldBucket(ids.branchA, orderId)) || '';
    hiddenOldOrderId = oldCompletedIds.find((orderId) => !visibleOldBucket(ids.branchA, orderId)) || '';
    if (!visibleOldOrderId || !hiddenOldOrderId) {
      throw new Error('fixture did not produce both visible and hidden old-order buckets');
    }

    for (let i = 0; i < 3; i += 1) {
      const orderId = randomUUID();
      recentCompletedIds.push(orderId);
      await client.query(
        `INSERT INTO public.orders
          (id, order_number, branch_id, order_type, status, cashier_id, subtotal, discount_amount, tax_amount, total, created_at, completed_at)
         VALUES ($1, $2, $3, 'takeaway', 'completed', $4, 20, 0, 0, 20, now() - interval '1 day', now() - interval '1 day')`,
        [orderId, `FV-ORDER-RECENT-${i}-${orderId.slice(0, 8)}`, ids.branchA, ids.users.cashier],
      );
    }

    // Active operational orders must remain visible even when old and even if
    // their deterministic historical bucket would otherwise be hidden.
    do {
      hiddenBucketActiveOrderId = randomUUID();
    } while (visibleOldBucket(ids.branchA, hiddenBucketActiveOrderId));
    await client.query(
      `INSERT INTO public.orders
        (id, order_number, branch_id, order_type, status, cashier_id, subtotal, discount_amount, tax_amount, total, created_at)
       VALUES ($1, $2, $3, 'takeaway', 'held', $4, 20, 0, 0, 20, now() - interval '30 days')`,
      [hiddenBucketActiveOrderId, `FV-ORDER-ACTIVE-${hiddenBucketActiveOrderId.slice(0, 8)}`, ids.branchA, ids.users.cashier],
    );

    visibleItemId = randomUUID();
    hiddenItemId = randomUUID();
    await client.query(
      `INSERT INTO public.order_items
        (id, order_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
       VALUES
        ($1, $2, $3, 'piece', 1, 20, 0, 0, 20),
        ($4, $5, $3, 'piece', 1, 20, 0, 0, 20)`,
      [visibleItemId, visibleOldOrderId, ids.prodA, hiddenItemId, hiddenOldOrderId],
    );

    do {
      otherBranchVisibleBucketOrderId = randomUUID();
    } while (!visibleOldBucket(ids.branchB, otherBranchVisibleBucketOrderId));
    await client.query(
      `INSERT INTO public.orders
        (id, order_number, branch_id, order_type, status, cashier_id, subtotal, discount_amount, tax_amount, total, created_at, completed_at)
       VALUES ($1, $2, $3, 'takeaway', 'completed', $4, 20, 0, 0, 20, now() - interval '30 days', now() - interval '30 days')`,
      [otherBranchVisibleBucketOrderId, `FV-ORDER-OTHER-${otherBranchVisibleBucketOrderId.slice(0, 8)}`, ids.branchB, ids.users.cashier_b],
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

  guarded('owner without history.unlimited sees sampled old completed orders', async () => {
    const result = await runAs(
      client,
      ids.users.owner,
      'SELECT id FROM public.orders WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldCompletedIds],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual(oldVisibleIds);
  });

  guarded('non-owner sees every completed order from the last seven days', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.orders WHERE id = ANY($1::uuid[]) ORDER BY id',
      [recentCompletedIds],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual([...recentCompletedIds].sort());
  });

  guarded('non-owner old completed history is the stable 30-of-100 set', async () => {
    const cashier = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.orders WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldCompletedIds],
    );
    const manager = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT id FROM public.orders WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldCompletedIds],
    );
    expect(cashier.error).toBeUndefined();
    expect(manager.error).toBeUndefined();
    expect(sortedIds(cashier.rows)).toEqual(oldVisibleIds);
    expect(sortedIds(manager.rows)).toEqual(oldVisibleIds);
  });

  guarded('old open or held orders remain fully visible for operations', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.orders WHERE id = $1',
      [hiddenBucketActiveOrderId],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual([hiddenBucketActiveOrderId]);
  });

  guarded('super_admin bypass sees complete old completed orders', async () => {
    const result = await runAs(
      client,
      ids.users.super_admin,
      'SELECT id FROM public.orders WHERE id = ANY($1::uuid[]) ORDER BY id',
      [oldCompletedIds],
    );
    expect(result.error).toBeUndefined();
    expect(sortedIds(result.rows)).toEqual([...oldCompletedIds].sort());
  });

  guarded('branch isolation still rejects another branch order even when its bucket is visible', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.orders WHERE id = $1',
      [otherBranchVisibleBucketOrderId],
    );
    expect(result.error).toBeUndefined();
    expect(result.rowCount).toBe(0);
  });

  guarded('order_items inherit their parent historical visibility', async () => {
    const restricted = await runAs(
      client,
      ids.users.cashier,
      'SELECT id FROM public.order_items WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visibleItemId, hiddenItemId]],
    );
    const owner = await runAs(
      client,
      ids.users.owner,
      'SELECT id FROM public.order_items WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visibleItemId, hiddenItemId]],
    );
    expect(restricted.error).toBeUndefined();
    expect(sortedIds(restricted.rows)).toEqual([visibleItemId]);
    expect(owner.error).toBeUndefined();
    expect(sortedIds(owner.rows)).toEqual([visibleItemId]);
  });

  guarded('historical order visibility policies are restrictive', async () => {
    const result = await client.query<{ tablename: string; policyname: string; permissive: string }>(
      `SELECT tablename, policyname, permissive
       FROM pg_policies
       WHERE schemaname = 'public'
         AND policyname IN ('financial_visibility_orders', 'financial_visibility_order_items')
       ORDER BY tablename`,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.permissive === 'RESTRICTIVE')).toBe(true);
  });
});
