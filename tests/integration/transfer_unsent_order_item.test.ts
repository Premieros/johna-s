import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('transfer unsent order item between tables', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  let sourceTable = '';
  let targetTable = '';
  let crossBranchTable = '';
  let sourceOrder = '';
  let targetOrder = '';
  let movableItem = '';
  let sentItem = '';
  let crossItem = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);

    // Make this test deterministic: cashier owns the source/target orders, but
    // starts without the independent transfer capability.
    await client.query(
      `UPDATE public.roles
       SET permissions = COALESCE(permissions, '[]'::jsonb) - 'pos.order.transfer'
       WHERE role = 'cashier'`,
    );

    const product = await client.query<{ id: string }>(
      `INSERT INTO public.products(name, sale_price, cost_price, branch_id, product_type)
       VALUES ('Transfer Test Product', 25, 10, $1::uuid, 'ready') RETURNING id`,
      [ids.branchA],
    );
    const productId = product.rows[0].id;

    const tables = await client.query<{ id: string; name: string }>(
      `INSERT INTO public.dining_tables(branch_id, name, status)
       VALUES
         ($1::uuid, 'Transfer Source', 'occupied'),
         ($1::uuid, 'Transfer Target', 'occupied'),
         ($2::uuid, 'Other Branch Target', 'vacant')
       RETURNING id, name`,
      [ids.branchA, ids.branchB],
    );
    sourceTable = tables.rows.find((row) => row.name === 'Transfer Source')!.id;
    targetTable = tables.rows.find((row) => row.name === 'Transfer Target')!.id;
    crossBranchTable = tables.rows.find((row) => row.name === 'Other Branch Target')!.id;

    const orders = await client.query<{ id: string; order_number: string }>(
      `INSERT INTO public.orders(order_number, branch_id, order_type, status, table_id, cashier_id)
       VALUES
         ('TR-SOURCE', $1::uuid, 'dine_in', 'open', $2::uuid, $4::uuid),
         ('TR-TARGET', $1::uuid, 'dine_in', 'open', $3::uuid, $4::uuid)
       RETURNING id, order_number`,
      [ids.branchA, sourceTable, targetTable, ids.users.cashier],
    );
    sourceOrder = orders.rows.find((row) => row.order_number === 'TR-SOURCE')!.id;
    targetOrder = orders.rows.find((row) => row.order_number === 'TR-TARGET')!.id;

    const items = await client.query<{ id: string; notes: string | null }>(
      `INSERT INTO public.order_items(order_id, product_id, quantity, unit_price, total, notes)
       VALUES
         ($1::uuid, $2::uuid, 1, 25, 25, 'movable'),
         ($1::uuid, $2::uuid, 1, 25, 25, 'sent-line'),
         ($1::uuid, $2::uuid, 1, 25, 25, 'cross-line')
       RETURNING id, notes`,
      [sourceOrder, productId],
    );
    movableItem = items.rows.find((row) => row.notes === 'movable')!.id;
    sentItem = items.rows.find((row) => row.notes === 'sent-line')!.id;
    crossItem = items.rows.find((row) => row.notes === 'cross-line')!.id;

    await client.query(
      `INSERT INTO public.order_kitchen_sends(branch_id, order_id, order_item_id, sent_quantity)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1)`,
      [ids.branchA, sourceOrder, sentItem],
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

  guarded('requires pos.order.transfer even for the source-order owner', async () => {
    const denied = await runAs(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, movableItem, targetTable],
    );
    expect(denied.error).toBeUndefined();
    expect(denied.rows[0].result).toMatchObject({
      success: false,
      error: 'PERMISSION_DENIED',
      permission: 'pos.order.transfer',
    });

    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN COALESCE(permissions, '[]'::jsonb) ? 'pos.order.transfer' THEN permissions
         ELSE COALESCE(permissions, '[]'::jsonb) || '["pos.order.transfer"]'::jsonb
       END
       WHERE role = 'cashier'`,
    );
  });

  guarded('moves an exact unsent line into an existing target order without KDS or inventory effects', async () => {
    const beforeSends = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM public.order_kitchen_sends');
    const beforeLedger = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM public.inventory_ledger');

    const result = await runAsPersist(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, movableItem, targetTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({
      success: true,
      source_order_id: sourceOrder,
      target_order_id: targetOrder,
      source_order_empty: false,
      inventory_changed: false,
      kds_changed: false,
    });

    const moved = await client.query<{ order_id: string; notes: string | null }>(
      `SELECT order_id, notes FROM public.order_items WHERE notes = 'movable'`,
    );
    expect(moved.rows).toHaveLength(1);
    expect(moved.rows[0].order_id).toBe(targetOrder);

    const audit = await client.query<{ user_id: string; details: Record<string, unknown> }>(
      `SELECT user_id, details
       FROM public.audit_log
       WHERE action = 'ORDER_ITEM_TABLE_TRANSFERRED'
         AND entity_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 1`,
      [movableItem],
    );
    expect(audit.rows[0].user_id).toBe(ids.users.cashier);
    expect(audit.rows[0].details).toMatchObject({ source_order_id: sourceOrder, target_order_id: targetOrder });

    const afterSends = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM public.order_kitchen_sends');
    const afterLedger = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM public.inventory_ledger');
    expect(afterSends.rows[0].count).toBe(beforeSends.rows[0].count);
    expect(afterLedger.rows[0].count).toBe(beforeLedger.rows[0].count);
  });

  guarded('rejects a line that has already been sent to kitchen', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, sentItem, targetTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'ITEM_ALREADY_SENT' });

    const row = await client.query<{ order_id: string }>('SELECT order_id FROM public.order_items WHERE id = $1::uuid', [sentItem]);
    expect(row.rows[0].order_id).toBe(sourceOrder);
  });

  guarded('does not allow a target table from another branch', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, crossItem, crossBranchTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'TARGET_TABLE_NOT_FOUND' });

    const row = await client.query<{ order_id: string }>('SELECT order_id FROM public.order_items WHERE id = $1::uuid', [crossItem]);
    expect(row.rows[0].order_id).toBe(sourceOrder);
  });
});