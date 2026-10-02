import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { attachRawComponentToUnit } from './componentTestFixtures';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('paid-order reopen guard', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const cashierId = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const unitA = randomUUID();
  const unitB = randomUUID();
  const tableId = randomUUID();

  const itemJson = (items: Array<{ product_id: string; quantity: number }>) =>
    JSON.stringify(items.map((item) => ({
      product_id: item.product_id,
      unit_name: 'piece',
      quantity: item.quantity,
      unit_price: 100,
      discount_amount: 0,
      bonus_quantity: 0,
      total: item.quantity * 100,
      modifier_option_ids: [],
    })));

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.organizations (id,name,slug) VALUES ($1,$2,$3)`,
      [orgId, 'Paid order guard org', `paid-guard-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches (id,name,organization_id) VALUES ($1,$2,$3)`,
      [branchId, 'Paid order guard branch', orgId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,$2,$3,true)`,
      [warehouseId, 'Paid order guard warehouse', branchId],
    );
    await client.query(
      `INSERT INTO public.dining_tables (id,name,branch_id,capacity,status) VALUES ($1,$2,$3,4,'vacant')`,
      [tableId, 'P-1', branchId],
    );

    for (const [productId, unitId, suffix] of [
      [productA, unitA, 'A'],
      [productB, unitB, 'B'],
    ] as const) {
      await client.query(
        `INSERT INTO public.products (id,name,branch_id,sale_price,cost_price,is_active)
         VALUES ($1,$2,$3,100,50,true)`,
        [productId, `Paid guard product ${suffix}`, branchId],
      );
      await client.query(
        `INSERT INTO public.inventory_units (id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
         VALUES ($1,$2,$3,'ready',$4,50,100,true)`,
        [unitId, `PG-${suffix}-${randomUUID()}`, `Paid guard unit ${suffix}`, branchId],
      );
      await client.query(
        `INSERT INTO public.product_unit_links (product_id,unit_id,quantity) VALUES ($1,$2,1)`,
        [productId, unitId],
      );
      await client.query(
        `INSERT INTO public.inventory_unit_batches (unit_id,branch_id,warehouse_id,quantity,unit_cost)
         VALUES ($1,$2,$3,100,50)`,
        [unitId, branchId, warehouseId],
      );
      await attachRawComponentToUnit(client, unitId, branchId, warehouseId, 100, 50);
    }

    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,$3,'cashier',$4,true)`,
      [cashierId, `paid-guard-${randomUUID()}@test.local`, 'Paid Guard Cashier', branchId],
    );
    await client.query(
      `INSERT INTO public.organization_members (organization_id,user_id,membership_role,is_active)
       VALUES ($1,$2,'member',true)`,
      [orgId, cashierId],
    );
    await client.query(
      `INSERT INTO public.shifts (branch_id,cashier_id,opening_amount,status)
       VALUES ($1,$2,0,'open')`,
      [branchId, cashierId],
    );
    await client.query(`UPDATE public.settings SET tax_enabled=false`);

    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN jsonb_typeof(COALESCE(permissions,'[]'::jsonb))='array'
           THEN COALESCE(permissions,'[]'::jsonb) || '["pos.void"]'::jsonb
         ELSE COALESCE(permissions,'{}'::jsonb) || '{"pos.void":true}'::jsonb
       END
       WHERE role='cashier'`,
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('blocks Void of settled quantity and closes the paid order after the final unresolved addition is voided', async () => {
    const created = await asUser(async () => client.query(
      `SELECT public.create_order(
         $1,'dine_in',$2,NULL,2,NULL,$3::jsonb,100,0,'amount',0,100,$4
       ) AS r`,
      [branchId, tableId, itemJson([{ product_id: productA, quantity: 1 }]), cashierId],
    ));
    const orderId = created.rows[0].r.order_id as string;
    expect(created.rows[0].r.success).toBe(true);

    const firstSend = await asUser(async () => client.query(
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    ));
    expect(firstSend.rows[0].r.success).toBe(true);

    const expandedCart = itemJson([
      { product_id: productA, quantity: 1 },
      { product_id: productB, quantity: 1 },
    ]);
    const expanded = await asUser(async () => client.query(
      `SELECT public.update_order(
         $1,'dine_in',NULL,NULL,2,NULL,$2::jsonb,200,0,'amount',0,200,'open'
       ) AS r`,
      [orderId, expandedCart],
    ));
    expect(expanded.rows[0].r.success).toBe(true);

    const previewQuery = await asUser(async () => client.query(
      `SELECT public.get_order_settlement_preview($1) AS r`,
      [orderId],
    ));
    const preview = previewQuery.rows[0].r as {
      success: boolean;
      items: unknown[];
      subtotal: number;
      discount_amount: number;
      tax_amount: number;
      total: number;
      unsent_quantity: number;
    };
    expect(preview.success).toBe(true);
    expect(Number(preview.unsent_quantity)).toBeGreaterThan(0);

    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);

    const saleQuery = await asUser(async () => client.query(
      `SELECT public.process_sale(
         $1,$2,$3,NULL,NULL,
         $4,$5,'amount',$6,0,$7,$7,
         'cash','completed',$8::jsonb,NULL,
         'dine_in',$9,$10,2
       ) AS r`,
      [
        `INV-PAID-GUARD-${randomUUID()}`,
        branchId,
        warehouseId,
        Number(preview.subtotal),
        Number(preview.discount_amount),
        Number(preview.tax_amount),
        Number(preview.total),
        JSON.stringify(preview.items),
        tableId,
        orderId,
      ],
    ));
    const sale = saleQuery.rows[0].r as {
      success: boolean;
      sale_id?: string;
      order_completed?: boolean;
    };
    expect(sale.success).toBe(true);
    expect(sale.order_completed).toBe(false);
    expect(sale.sale_id).toBeTruthy();

    const lines = await client.query<{ id: string; product_id: string }>(
      `SELECT id,product_id FROM public.order_items WHERE order_id=$1`,
      [orderId],
    );
    const settledItemId = lines.rows.find((row) => row.product_id === productA)?.id;
    const pendingItemId = lines.rows.find((row) => row.product_id === productB)?.id;
    expect(settledItemId).toBeTruthy();
    expect(pendingItemId).toBeTruthy();

    const paidVoid = await asUser(async () => client.query(
      `SELECT public.cancel_sent_order_item_exact($1,$2,1,'wrong paid item') AS r`,
      [orderId, settledItemId],
    ));
    expect(paidVoid.rows[0].r.success).toBe(false);
    expect(paidVoid.rows[0].r.error).toBe('PAID_ITEM_REFUND_REQUIRED');

    const settledLineStillExists = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.order_items WHERE id=$1 AND order_id=$2`,
      [settledItemId, orderId],
    );
    expect(settledLineStillExists.rows[0].c).toBe(1);

    const secondSend = await asUser(async () => client.query(
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    ));
    expect(secondSend.rows[0].r.success).toBe(true);
    expect(Number(secondSend.rows[0].r.items_sent_count)).toBe(1);

    const unresolvedVoid = await asUser(async () => client.query(
      `SELECT public.cancel_sent_order_item_exact($1,$2,1,'remove unpaid addition') AS r`,
      [orderId, pendingItemId],
    ));
    expect(unresolvedVoid.rows[0].r.success).toBe(true);

    const closed = await client.query<{
      status: string;
      payment_status: string;
      table_status: string;
    }>(
      `SELECT o.status,o.payment_status,t.status AS table_status
       FROM public.orders o
       JOIN public.dining_tables t ON t.id=o.table_id
       WHERE o.id=$1`,
      [orderId],
    );
    expect(closed.rows[0].status).toBe('completed');
    expect(closed.rows[0].payment_status).toBe('paid');
    expect(closed.rows[0].table_status).toBe('vacant');

    const saleCount = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.sales WHERE source_order_id=$1`,
      [orderId],
    );
    expect(saleCount.rows[0].c).toBe(1);
  });
});
