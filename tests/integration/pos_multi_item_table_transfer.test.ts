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
  let crossBranchTable = '';
  let sourceOrder = '';
  let targetOrder = '';
  let itemA = '';
  let itemB = '';
  let sentItem = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);

    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN COALESCE(permissions,'[]'::jsonb) ? 'pos.order.transfer' THEN permissions
         ELSE COALESCE(permissions,'[]'::jsonb) || '["pos.order.transfer"]'::jsonb
       END
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
         ($2::uuid,'Multi Other Branch','vacant')
       RETURNING id,name`,
      [ids.branchA, ids.branchB],
    );
    sourceTable = tables.rows.find((row) => row.name === 'Multi Source')!.id;
    targetTable = tables.rows.find((row) => row.name === 'Multi Target')!.id;
    crossBranchTable = tables.rows.find((row) => row.name === 'Multi Other Branch')!.id;

    const orders = await client.query<{ id: string; order_number: string }>(
      `INSERT INTO public.orders(
         order_number,branch_id,order_type,status,table_id,cashier_id,
         subtotal,discount_amount,discount_type,tax_amount,total
       )
       VALUES
         ('MULTI-SOURCE',$1::uuid,'dine_in','open',$2::uuid,$4::uuid,90,9,'amount',4.5,85.5),
         ('MULTI-TARGET',$1::uuid,'dine_in','open',$3::uuid,$4::uuid,30,0,'amount',0,30)
       RETURNING id,order_number`,
      [ids.branchA, sourceTable, targetTable, ids.users.cashier],
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

    await client.query(
      `INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity)
       VALUES($1::uuid,$2::uuid,$3::uuid,1)`,
      [ids.branchA, sourceOrder, sentItem],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  it('moves multiple unsent lines atomically to another table order', async (ctx) => {
    if (!imp) return ctx.skip();

    const beforeSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const beforeLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');

    const moved = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.transfer_order_items_to_table(
         $1::uuid,
         ARRAY[$2::uuid,$3::uuid],
         $4::uuid
       ) AS result`,
      [sourceOrder, itemA, itemB, targetTable],
    );
    expect(moved.error).toBeUndefined();
    expect(moved.rows[0].result).toMatchObject({
      success: true,
      source_order_id: sourceOrder,
      target_order_id: targetOrder,
      moved_item_count: 2,
      source_order_empty: false,
      inventory_changed: false,
      kds_changed: false,
    });

    const lines = await client.query<{ id: string; order_id: string }>(
      `SELECT id,order_id FROM public.order_items WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[itemA, itemB, sentItem]],
    );
    expect(lines.find((row) => row.id === itemA)?.order_id).toBe(targetOrder);
    expect(lines.find((row) => row.id === itemB)?.order_id).toBe(targetOrder);
    expect(lines.find((row) => row.id === sentItem)?.order_id).toBe(sourceOrder);

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

    const audit = await client.query<{ details: Record<string, unknown> }>(
      `SELECT details
       FROM public.audit_log
       WHERE action='ORDER_ITEMS_TABLE_TRANSFERRED' AND entity_id=$1::uuid
       ORDER BY created_at DESC LIMIT 1`,
      [sourceOrder],
    );
    expect(audit.rows[0].details).toMatchObject({
      item_count: 2,
      source_table_id: sourceTable,
      target_table_id: targetTable,
      target_order_id: targetOrder,
      inventory_changed: false,
      kds_changed: false,
    });

    const afterSends = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.order_kitchen_sends');
    const afterLedger = await client.query<{ n: string }>('SELECT count(*)::text n FROM public.inventory_ledger');
    expect(afterSends.rows[0].n).toBe(beforeSends.rows[0].n);
    expect(afterLedger.rows[0].n).toBe(beforeLedger.rows[0].n);
  });

  it('rejects sent lines without partial movement', async (ctx) => {
    if (!imp) return ctx.skip();

    const result = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.transfer_order_items_to_table(
         $1::uuid,
         ARRAY[$2::uuid],
         $3::uuid
       ) AS result`,
      [sourceOrder, sentItem, targetTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'ITEM_ALREADY_SENT' });

    const row = await client.query<{ order_id: string }>(
      'SELECT order_id FROM public.order_items WHERE id=$1::uuid',
      [sentItem],
    );
    expect(row.rows[0].order_id).toBe(sourceOrder);
  });

  it('rejects a target table from another branch', async (ctx) => {
    if (!imp) return ctx.skip();

    const extra = await client.query<{ id: string }>(
      `INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,total,notes)
       SELECT $1::uuid,product_id,1,30,30,'cross-branch'
       FROM public.order_items
       WHERE id=$2::uuid
       RETURNING id`,
      [sourceOrder, sentItem],
    );

    const result = await runAs(
      client,
      ids.users.cashier,
      `SELECT public.transfer_order_items_to_table(
         $1::uuid,
         ARRAY[$2::uuid],
         $3::uuid
       ) AS result`,
      [sourceOrder, extra.rows[0].id, crossBranchTable],
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].result).toMatchObject({ success: false, error: 'TARGET_TABLE_NOT_FOUND' });
  });
});
