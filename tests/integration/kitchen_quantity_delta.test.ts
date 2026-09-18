import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('KDS quantity delta sends', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();
  const cashierId = randomUUID();

  const itemJson = (quantity: number) => JSON.stringify([{
    product_id: productId,
    unit_name: 'piece',
    quantity,
    unit_price: 100,
    discount_amount: 0,
    bonus_quantity: 0,
    total: quantity * 100,
  }]);

  async function asCashier<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function send(orderId: string) {
    return asCashier(async () => {
      const r = await client.query(`SELECT public.send_to_kitchen($1) AS r`, [orderId]);
      return r.rows[0].r;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.organizations(id,name,slug) VALUES($1,$2,$3)`, [orgId, 'KDS Delta Org', `kds-delta-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches(id,name,organization_id) VALUES($1,$2,$3)`, [branchId, 'KDS Delta Branch', orgId]);
    await client.query(`INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,$2,$3,true,true)`, [warehouseId, 'KDS Delta Warehouse', branchId]);
    await client.query(`INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,$2,$3,100,50,true)`, [productId, 'KDS Delta Product', branchId]);
    await client.query(`INSERT INTO public.inventory_batches(product_id,warehouse_id,branch_id,quantity,unit_cost) VALUES($1,$2,$3,30,50)`, [productId, warehouseId, branchId]);
    await client.query(`INSERT INTO public.inventory(product_id,warehouse_id,branch_id,quantity) VALUES($1,$2,$3,30)`, [productId, warehouseId, branchId]);
    await client.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,$3,'cashier',$4,true)`, [cashierId, `kds-delta-${randomUUID()}@test.local`, 'Delta Cashier', branchId]);
    await client.query(`INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active) VALUES($1,$2,'member',true)`, [orgId, cashierId]);
    await client.query(`INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status) VALUES($1,$2,0,'open')`, [branchId, cashierId]);
    await client.query(`UPDATE public.settings SET tax_enabled=false`);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('sends only the increase for the same stable order_item_id', async () => {
    const created = await asCashier(async () => {
      const r = await client.query(
        `SELECT public.create_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,100,0,'amount',0,100,$3) AS r`,
        [branchId, itemJson(1), cashierId],
      );
      return r.rows[0].r;
    });
    expect(created.success).toBe(true);
    const orderId = String(created.order_id);

    const first = await send(orderId);
    expect(first.success).toBe(true);
    expect(first.items_sent_count).toBe(1);
    expect(Number(first.sent[0].quantity)).toBe(1);
    const afterFirst = Number((await client.query(`SELECT quantity FROM public.inventory_batches WHERE product_id=$1 AND warehouse_id=$2`, [productId, warehouseId])).rows[0].quantity);
    expect(afterFirst).toBe(29);
    const itemId = String(first.sent[0].order_item_id);

    const firstSnapshot = await client.query(
      `SELECT order_item_id,sent_quantity FROM public.order_kitchen_sends WHERE order_id=$1`,
      [orderId],
    );
    expect(firstSnapshot.rows).toHaveLength(1);
    expect(String(firstSnapshot.rows[0].order_item_id)).toBe(itemId);
    expect(Number(firstSnapshot.rows[0].sent_quantity)).toBe(1);

    const updated = await asCashier(async () => {
      const r = await client.query(
        `SELECT public.update_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,300,0,'amount',0,300,'held') AS r`,
        [orderId, itemJson(3)],
      );
      return r.rows[0].r;
    });
    expect(updated.success).toBe(true);

    const stable = await client.query(`SELECT id,quantity FROM public.order_items WHERE order_id=$1`, [orderId]);
    expect(stable.rows).toHaveLength(1);
    expect(String(stable.rows[0].id)).toBe(itemId);
    expect(Number(stable.rows[0].quantity)).toBe(3);

    const delta = await send(orderId);
    expect(delta.success).toBe(true);
    expect(delta.items_sent_count).toBe(1);
    expect(delta.sent).toHaveLength(1);
    expect(String(delta.sent[0].order_item_id)).toBe(itemId);
    expect(Number(delta.sent[0].quantity)).toBe(2);
    expect(Number(delta.sent[0].current_quantity)).toBe(3);
    const afterDelta = Number((await client.query(`SELECT quantity FROM public.inventory_batches WHERE product_id=$1 AND warehouse_id=$2`, [productId, warehouseId])).rows[0].quantity);
    expect(afterDelta).toBe(27);

    const snapshot = await client.query(
      `SELECT count(*)::int AS rows,max(sent_quantity)::numeric AS sent_quantity FROM public.order_kitchen_sends WHERE order_id=$1`,
      [orderId],
    );
    expect(snapshot.rows[0].rows).toBe(1);
    expect(Number(snapshot.rows[0].sent_quantity)).toBe(3);

    const noOp = await send(orderId);
    expect(noOp.success).toBe(true);
    expect(noOp.items_sent_count).toBe(0);
    expect(noOp.all_sent).toBe(true);
    expect(Number((await client.query(`SELECT quantity FROM public.inventory_batches WHERE product_id=$1 AND warehouse_id=$2`, [productId, warehouseId])).rows[0].quantity)).toBe(afterDelta);
  });

  it('reduces sent_quantity after a kitchen void so a later increase sends the correct net delta', async () => {
    const created = await asCashier(async () => {
      const r = await client.query(
        `SELECT public.create_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,300,0,'amount',0,300,$3) AS r`,
        [branchId, itemJson(3), cashierId],
      );
      return r.rows[0].r;
    });
    expect(created.success).toBe(true);
    const orderId = String(created.order_id);
    const first = await send(orderId);
    const itemId = String(first.sent[0].order_item_id);
    expect(Number(first.sent[0].quantity)).toBe(3);
    const beforeVoid = Number((await client.query(`SELECT quantity FROM public.inventory_batches WHERE product_id=$1 AND warehouse_id=$2`, [productId, warehouseId])).rows[0].quantity);

    // Mirror the server-authorized partial void: reduce the line and insert the
    // void event. The AFTER INSERT trigger must reduce the net KDS quantity.
    const restored = await client.query(`SELECT public._restore_kitchen_inventory_for_void($1,$2,1) AS r`, [orderId, itemId]);
    expect(restored.rows[0].r.success).toBe(true);
    await client.query(`SELECT set_config('app.approved_sent_item_void','1',true)`);
    await client.query(`UPDATE public.order_items SET quantity=2,total=200 WHERE id=$1`, [itemId]);
    await client.query(
      `INSERT INTO public.order_kitchen_voids(branch_id,order_id,order_item_id,product_id,product_name,unit_name,quantity,reason,voided_by)
       VALUES($1,$2,$3,$4,'KDS Delta Product','piece',1,'approved test void',$5)`,
      [branchId, orderId, itemId, productId, cashierId],
    );

    const afterVoid = await client.query(`SELECT sent_quantity FROM public.order_kitchen_sends WHERE order_item_id=$1`, [itemId]);
    expect(Number(afterVoid.rows[0].sent_quantity)).toBe(2);

    const updated = await asCashier(async () => {
      const r = await client.query(
        `SELECT public.update_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,400,0,'amount',0,400,'held') AS r`,
        [orderId, itemJson(4)],
      );
      return r.rows[0].r;
    });
    expect(updated.success).toBe(true);

    const delta = await send(orderId);
    expect(delta.success).toBe(true);
    expect(delta.items_sent_count).toBe(1);
    expect(Number(delta.sent[0].quantity)).toBe(2);
    expect(Number(delta.sent[0].current_quantity)).toBe(4);
    const aggregateAfterDelta = await client.query(
      `SELECT COALESCE(SUM(quantity),0)::numeric AS quantity FROM public.inventory_batches WHERE product_id=$1 AND warehouse_id=$2`,
      [productId, warehouseId],
    );
    expect(Number(aggregateAfterDelta.rows[0].quantity)).toBe(beforeVoid - 1);
  });
  it('blocks deleting a sent line until every pending kitchen inventory event is restored', async () => {
    const created = await asCashier(async () => {
      const r = await client.query(
        `SELECT public.create_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,100,0,'amount',0,100,$3) AS r`,
        [branchId, itemJson(1), cashierId],
      );
      return r.rows[0].r;
    });
    expect(created.success).toBe(true);
    const orderId = String(created.order_id);
    const first = await send(orderId);
    expect(first.success).toBe(true);
    const itemId = String(first.sent[0].order_item_id);

    await client.query('SAVEPOINT before_invalid_sent_delete');
    await client.query(`SELECT set_config('app.approved_sent_item_void','1',true)`);
    await expect(client.query(`DELETE FROM public.order_items WHERE id=$1`, [itemId]))
      .rejects.toThrow(/SENT_ITEM_VOID_INCOMPLETE/);
    await client.query('ROLLBACK TO SAVEPOINT before_invalid_sent_delete');
    await client.query('RELEASE SAVEPOINT before_invalid_sent_delete');

    const restored = await client.query(
      `SELECT public._restore_kitchen_inventory_for_void($1,$2,1) AS r`,
      [orderId, itemId],
    );
    expect(restored.rows[0].r.success).toBe(true);
    expect(Number(restored.rows[0].r.restored_sent_quantity)).toBe(1);

    await client.query(`SELECT set_config('app.approved_sent_item_void','1',true)`);
    await client.query(`DELETE FROM public.order_items WHERE id=$1`, [itemId]);

    const pending = await client.query(
      `SELECT COALESCE(SUM(sent_quantity-voided_quantity),0)::numeric AS q
       FROM public.order_kitchen_inventory_events
       WHERE order_id=$1 AND order_item_id=$2
         AND settled_sale_id IS NULL AND sent_quantity>voided_quantity`,
      [orderId, itemId],
    );
    expect(Number(pending.rows[0].q)).toBe(0);
  });

});
