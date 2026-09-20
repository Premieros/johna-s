import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('legacy single-item POS table transfer compatibility', () => {
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
  let kitchenSendId = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);

    await client.query(
      `UPDATE public.roles
       SET permissions = COALESCE(permissions, '[]'::jsonb)
         - 'pos.order.transfer'
         - 'users.manage'
       WHERE role = 'cashier'`,
    );

    const product = await client.query<{ id: string }>(
      `INSERT INTO public.products(name, sale_price, cost_price, branch_id, product_type)
       VALUES ('Legacy Transfer Product', 25, 10, $1::uuid, 'ready') RETURNING id`,
      [ids.branchA],
    );
    const productId = product.rows[0].id;

    const tables = await client.query<{ id: string; name: string }>(
      `INSERT INTO public.dining_tables(branch_id, name, status)
       VALUES
         ($1::uuid, 'Legacy Transfer Source', 'occupied'),
         ($1::uuid, 'Legacy Transfer Target', 'occupied'),
         ($2::uuid, 'Legacy Other Branch Target', 'vacant')
       RETURNING id, name`,
      [ids.branchA, ids.branchB],
    );
    sourceTable = tables.rows.find((row) => row.name === 'Legacy Transfer Source')!.id;
    targetTable = tables.rows.find((row) => row.name === 'Legacy Transfer Target')!.id;
    crossBranchTable = tables.rows.find((row) => row.name === 'Legacy Other Branch Target')!.id;

    const orders = await client.query<{ id: string; order_number: string }>(
      `INSERT INTO public.orders(
         order_number, branch_id, order_type, status, table_id, cashier_id,
         subtotal, discount_amount, discount_type, tax_amount, total
       )
       VALUES
         ('LEGACY-TR-SOURCE', $1::uuid, 'dine_in', 'open', $2::uuid, $4::uuid, 75, 0, 'amount', 0, 75),
         ('LEGACY-TR-TARGET', $1::uuid, 'dine_in', 'open', $3::uuid, $5::uuid, 0, 0, 'amount', 0, 0)
       RETURNING id, order_number`,
      [ids.branchA, sourceTable, targetTable, ids.users.cashier, ids.users.branch_manager],
    );
    sourceOrder = orders.rows.find((row) => row.order_number === 'LEGACY-TR-SOURCE')!.id;
    targetOrder = orders.rows.find((row) => row.order_number === 'LEGACY-TR-TARGET')!.id;

    const items = await client.query<{ id: string; notes: string | null }>(
      `INSERT INTO public.order_items(order_id, product_id, quantity, unit_price, total, notes)
       VALUES
         ($1::uuid, $2::uuid, 1, 25, 25, 'legacy-movable'),
         ($1::uuid, $2::uuid, 1, 25, 25, 'legacy-sent'),
         ($1::uuid, $2::uuid, 1, 25, 25, 'legacy-cross')
       RETURNING id, notes`,
      [sourceOrder, productId],
    );
    movableItem = items.rows.find((row) => row.notes === 'legacy-movable')!.id;
    sentItem = items.rows.find((row) => row.notes === 'legacy-sent')!.id;
    crossItem = items.rows.find((row) => row.notes === 'legacy-cross')!.id;

    const send = await client.query<{ id: string }>(
      `INSERT INTO public.order_kitchen_sends(
         branch_id, order_id, order_item_id, sent_quantity, sent_by
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::uuid)
       RETURNING id`,
      [ids.branchA, sourceOrder, sentItem, ids.users.cashier],
    );
    kitchenSendId = send.rows[0].id;

    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events(
         branch_id, warehouse_id, order_id, order_item_id, kitchen_send_id,
         sent_quantity, voided_quantity, total_cost, created_by
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 0, 10, $6::uuid)`,
      [ids.branchA, ids.whA, sourceOrder, sentItem, kitchenSendId, ids.users.cashier],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!imp) return ctx.skip();
      await fn();
    });

  guarded('requires pos.order.transfer before delegating the legacy call', async () => {
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

  guarded('moves an unsent line through the canonical flow even when the target order belongs to another operator', async () => {
    const beforeSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const beforeLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');

    const moved = await runAsPersist(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, movableItem, targetTable],
    );
    expect(moved.error).toBeUndefined();
    expect(moved.rows[0].result).toMatchObject({
      success: true,
      source_order_id: sourceOrder,
      target_order_id: targetOrder,
      moved_item_count: 1,
      moved_sent_item_count: 0,
      new_order_item_id: movableItem,
      source_order_empty: false,
      inventory_changed: false,
      kds_changed: false,
      kds_resent: false,
    });

    const item = await client.query<{ order_id: string }>(
      'SELECT order_id FROM public.order_items WHERE id=$1::uuid',
      [movableItem],
    );
    expect(item.rows[0].order_id).toBe(targetOrder);

    const afterSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const afterLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');
    expect(afterSends.rows[0].n).toBe(beforeSends.rows[0].n);
    expect(afterLedger.rows[0].n).toBe(beforeLedger.rows[0].n);
  });

  guarded('moves a sent line without resend or additional stock deduction', async () => {
    const beforeSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const beforeEvents = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_inventory_events');
    const beforeLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');

    const moved = await runAsPersist(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, sentItem, targetTable],
    );
    expect(moved.error).toBeUndefined();
    expect(moved.rows[0].result).toMatchObject({
      success: true,
      target_order_id: targetOrder,
      moved_item_count: 1,
      moved_sent_item_count: 1,
      new_order_item_id: sentItem,
      inventory_changed: false,
      kds_changed: true,
      kds_reassigned: true,
      kds_resent: false,
    });

    const item = await client.query<{ order_id: string }>(
      'SELECT order_id FROM public.order_items WHERE id=$1::uuid',
      [sentItem],
    );
    expect(item.rows[0].order_id).toBe(targetOrder);

    const lineage = await client.query<{ send_order_id: string; event_order_id: string }>(
      `SELECT s.order_id AS send_order_id, e.order_id AS event_order_id
       FROM public.order_kitchen_sends s
       JOIN public.order_kitchen_inventory_events e ON e.kitchen_send_id=s.id
       WHERE s.id=$1::uuid`,
      [kitchenSendId],
    );
    expect(lineage.rows[0]).toEqual({
      send_order_id: targetOrder,
      event_order_id: targetOrder,
    });

    const afterSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const afterEvents = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_inventory_events');
    const afterLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');
    expect(afterSends.rows[0].n).toBe(beforeSends.rows[0].n);
    expect(afterEvents.rows[0].n).toBe(beforeEvents.rows[0].n);
    expect(afterLedger.rows[0].n).toBe(beforeLedger.rows[0].n);
  });

  guarded('still rejects a target table from another branch', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT public.transfer_order_item_to_table($1::uuid, $2::uuid, $3::uuid) AS result',
      [sourceOrder, crossItem, crossBranchTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'TARGET_TABLE_NOT_FOUND' });

    const item = await client.query<{ order_id: string }>(
      'SELECT order_id FROM public.order_items WHERE id=$1::uuid',
      [crossItem],
    );
    expect(item.rows[0].order_id).toBe(sourceOrder);
  });
});
