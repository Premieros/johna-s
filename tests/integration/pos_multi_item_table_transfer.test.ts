import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('multi-item POS table transfer', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  let sourceTable = '';
  let targetTable = '';
  let vacantTargetTable = '';
  let crossBranchTable = '';
  let sourceOrder = '';
  let targetOrder = '';
  let itemA = '';
  let itemB = '';
  let sentItem = '';
  let kitchenSendId = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);

    // The executor has transfer permission, but deliberately does NOT have the
    // broad users.manage capability. The dedicated RPC context must be enough.
    await client.query(
      `UPDATE public.roles
       SET permissions = (
         CASE
           WHEN COALESCE(permissions,'[]'::jsonb) ? 'pos.order.transfer' THEN permissions
           ELSE COALESCE(permissions,'[]'::jsonb) || '["pos.order.transfer"]'::jsonb
         END
       ) - 'users.manage'
       WHERE role='cashier'`,
    );

    const product = await client.query<{ id: string }>(
      `INSERT INTO public.products(name,sale_price,cost_price,branch_id,product_type)
       VALUES('Multi transfer product',30,10,$1::uuid,'ready')
       RETURNING id`,
      [ids.branchA],
    );
    const productId = product.rows[0].id;

    const tables = await client.query<{ id: string; name: string }>(
      `INSERT INTO public.dining_tables(branch_id,name,status)
       VALUES
         ($1::uuid,'Multi Source','occupied'),
         ($1::uuid,'Multi Target','occupied'),
         ($1::uuid,'Multi Vacant Target','vacant'),
         ($2::uuid,'Multi Other Branch','vacant')
       RETURNING id,name`,
      [ids.branchA, ids.branchB],
    );
    sourceTable = tables.rows.find((row) => row.name === 'Multi Source')!.id;
    targetTable = tables.rows.find((row) => row.name === 'Multi Target')!.id;
    vacantTargetTable = tables.rows.find((row) => row.name === 'Multi Vacant Target')!.id;
    crossBranchTable = tables.rows.find((row) => row.name === 'Multi Other Branch')!.id;

    const orders = await client.query<{ id: string; order_number: string }>(
      `INSERT INTO public.orders(
         order_number,branch_id,order_type,status,table_id,cashier_id,
         subtotal,discount_amount,discount_type,tax_amount,total
       )
       VALUES
         ('MULTI-SOURCE',$1::uuid,'dine_in','open',$2::uuid,$4::uuid,90,9,'amount',4.5,85.5),
         ('MULTI-TARGET',$1::uuid,'dine_in','open',$3::uuid,$5::uuid,30,0,'amount',0,30)
       RETURNING id,order_number`,
      [ids.branchA, sourceTable, targetTable, ids.users.cashier, ids.users.branch_manager],
    );
    sourceOrder = orders.rows.find((row) => row.order_number === 'MULTI-SOURCE')!.id;
    targetOrder = orders.rows.find((row) => row.order_number === 'MULTI-TARGET')!.id;

    const rows = await client.query<{ id: string; notes: string | null }>(
      `INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,total,notes)
       VALUES
         ($1::uuid,$2::uuid,1,30,30,'move-a'),
         ($1::uuid,$2::uuid,1,30,30,'move-b'),
         ($1::uuid,$2::uuid,1,30,30,'sent')
       RETURNING id,notes`,
      [sourceOrder, productId],
    );
    itemA = rows.rows.find((row) => row.notes === 'move-a')!.id;
    itemB = rows.rows.find((row) => row.notes === 'move-b')!.id;
    sentItem = rows.rows.find((row) => row.notes === 'sent')!.id;

    const send = await client.query<{ id: string }>(
      `INSERT INTO public.order_kitchen_sends(
         branch_id,order_id,order_item_id,sent_quantity,sent_by
       )
       VALUES($1::uuid,$2::uuid,$3::uuid,1,$4::uuid)
       RETURNING id`,
      [ids.branchA, sourceOrder, sentItem, ids.users.cashier],
    );
    kitchenSendId = send.rows[0].id;

    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events(
         branch_id,warehouse_id,order_id,order_item_id,kitchen_send_id,
         sent_quantity,voided_quantity,total_cost,created_by
       )
       VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,0,10,$6::uuid)`,
      [ids.branchA, ids.whA, sourceOrder, sentItem, kitchenSendId, ids.users.cashier],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  it('moves multiple lines including a sent line into another user order without resend or stock deduction', async (ctx) => {
    if (!imp) return ctx.skip();

    const beforeSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const beforeEvents = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_inventory_events');
    const beforeLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');

    const moved = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.transfer_order_items_to_table(
         $1::uuid,
         ARRAY[$2::uuid,$3::uuid],
         $4::uuid
       ) AS result`,
      [sourceOrder, itemA, sentItem, targetTable],
    );
    expect(moved.error).toBeUndefined();
    expect(moved.rows[0].result).toMatchObject({
      success: true,
      source_order_id: sourceOrder,
      target_order_id: targetOrder,
      target_owner_id: ids.users.branch_manager,
      moved_item_count: 2,
      moved_sent_item_count: 1,
      source_order_empty: false,
      inventory_changed: false,
      kds_reassigned: true,
      kds_resent: false,
    });

    const lines = await client.query<{ id: string; order_id: string }>(
      `SELECT id,order_id FROM public.order_items
       WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[itemA, itemB, sentItem]],
    );
    expect(lines.rows.find((row) => row.id === itemA)?.order_id).toBe(targetOrder);
    expect(lines.rows.find((row) => row.id === sentItem)?.order_id).toBe(targetOrder);
    expect(lines.rows.find((row) => row.id === itemB)?.order_id).toBe(sourceOrder);

    const targetOwner = await client.query<{ cashier_id: string }>(
      'SELECT cashier_id FROM public.orders WHERE id=$1',
      [targetOrder],
    );
    expect(targetOwner.rows[0].cashier_id).toBe(ids.users.branch_manager);

    const kitchenLineage = await client.query<{
      send_order_id: string;
      event_order_id: string;
      sent_by: string;
      created_by: string;
    }>(
      `SELECT
         s.order_id AS send_order_id,
         e.order_id AS event_order_id,
         s.sent_by,
         e.created_by
       FROM public.order_kitchen_sends s
       JOIN public.order_kitchen_inventory_events e
         ON e.kitchen_send_id=s.id
       WHERE s.id=$1::uuid`,
      [kitchenSendId],
    );
    expect(kitchenLineage.rows[0]).toEqual({
      send_order_id: targetOrder,
      event_order_id: targetOrder,
      sent_by: ids.users.cashier,
      created_by: ids.users.cashier,
    });

    const source = await client.query<{ discount_amount: string; tax_amount: string }>(
      'SELECT discount_amount::text,tax_amount::text FROM public.orders WHERE id=$1',
      [sourceOrder],
    );
    const target = await client.query<{ discount_amount: string; tax_amount: string }>(
      'SELECT discount_amount::text,tax_amount::text FROM public.orders WHERE id=$1',
      [targetOrder],
    );
    expect(Number(source.rows[0].discount_amount)).toBeCloseTo(3, 4);
    expect(Number(source.rows[0].tax_amount)).toBeCloseTo(1.5, 4);
    expect(Number(target.rows[0].discount_amount)).toBeCloseTo(6, 4);
    expect(Number(target.rows[0].tax_amount)).toBeCloseTo(3, 4);

    const afterSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const afterEvents = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_inventory_events');
    const afterLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');
    expect(afterSends.rows[0].n).toBe(beforeSends.rows[0].n);
    expect(afterEvents.rows[0].n).toBe(beforeEvents.rows[0].n);
    expect(afterLedger.rows[0].n).toBe(beforeLedger.rows[0].n);
  });

  it('rejects a target table from another branch without moving the remaining line', async (ctx) => {
    if (!imp) return ctx.skip();

    const result = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.transfer_order_items_to_table(
         $1::uuid,
         ARRAY[$2::uuid],
         $3::uuid
       ) AS result`,
      [sourceOrder, itemB, crossBranchTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'TARGET_TABLE_NOT_FOUND' });

    const row = await client.query<{ order_id: string }>(
      'SELECT order_id FROM public.order_items WHERE id=$1::uuid',
      [itemB],
    );
    expect(row.rows[0].order_id).toBe(sourceOrder);
  });

  it('keeps the source operator when the selected item moves to a vacant table', async (ctx) => {
    if (!imp) return ctx.skip();

    const moved = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.transfer_order_items_to_table(
         $1::uuid,
         ARRAY[$2::uuid],
         $3::uuid
       ) AS result`,
      [sourceOrder, itemB, vacantTargetTable],
    );
    expect(moved.error).toBeUndefined();
    expect(moved.rows[0].result).toMatchObject({
      success: true,
      source_order_id: sourceOrder,
      target_owner_id: ids.users.cashier,
      moved_item_count: 1,
      moved_sent_item_count: 0,
      source_order_empty: true,
      inventory_changed: false,
      kds_reassigned: false,
      kds_resent: false,
    });

    const movedResult = moved.rows[0].result as Record<string, unknown>;
    const newOrderId = String(movedResult.target_order_id || '');
    const target = await client.query<{ cashier_id: string; table_id: string; status: string }>(
      'SELECT cashier_id,table_id,status FROM public.orders WHERE id=$1::uuid',
      [newOrderId],
    );
    expect(target.rows[0]).toEqual({
      cashier_id: ids.users.cashier,
      table_id: vacantTargetTable,
      status: 'open',
    });

    const source = await client.query<{ status: string }>(
      'SELECT status FROM public.orders WHERE id=$1::uuid',
      [sourceOrder],
    );
    expect(source.rows[0].status).toBe('cancelled');
  });
});
