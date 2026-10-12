import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { attachDirectRawComponentToProduct, rawQtyForProduct } from './componentTestFixtures';

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

  async function stockQty(): Promise<number> {
    return rawQtyForProduct(client, productId, branchId, warehouseId);
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
    await attachDirectRawComponentToProduct(client, productId, branchId, warehouseId, 30, 50, 1);
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
    const afterFirst = await stockQty();
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
    const afterDelta = await stockQty();
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
    expect(await stockQty()).toBe(afterDelta);
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
    const beforeVoid = await stockQty();

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
    expect(await stockQty()).toBe(beforeVoid - 1);
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


  it('reopens a served order and exposes only the new kitchen delta', async () => {
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
    const itemId = String(first.sent[0].order_item_id);

    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SELECT public.set_kitchen_status($1, 'served')`, [orderId]);
    await client.query(`RESET ROLE`);

    const servedBaseline = await client.query(
      `SELECT served_quantity
       FROM public.order_kitchen_served_quantities
       WHERE order_id=$1 AND order_item_id=$2`,
      [orderId, itemId],
    );
    expect(Number(servedBaseline.rows[0]?.served_quantity)).toBe(1);

    const updated = await asCashier(async () => {
      const r = await client.query(
        `SELECT public.update_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,300,0,'amount',0,300,'open') AS r`,
        [orderId, itemJson(3)],
      );
      return r.rows[0].r;
    });
    expect(updated.success).toBe(true);

    const reopened = await send(orderId);
    expect(reopened.success, JSON.stringify(reopened)).toBe(true);
    expect(reopened.items_sent_count).toBe(1);
    expect(Number(reopened.sent[0].quantity)).toBe(2);

    const orderState = await client.query(
      `SELECT kitchen_status FROM public.orders WHERE id=$1`,
      [orderId],
    );
    expect(orderState.rows[0].kitchen_status).toBe('sent');

    await client.query(`SET LOCAL ROLE service_role`);
    const queue = await client.query(
      `SELECT items FROM public.get_kitchen_queue(NULL, $1) WHERE order_id=$2`,
      [branchId, orderId],
    );
    await client.query(`RESET ROLE`);

    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0].items).toHaveLength(1);
    expect(String(queue.rows[0].items[0].order_item_id)).toBe(itemId);
    expect(Number(queue.rows[0].items[0].quantity)).toBe(2);

    await client.query(`SET LOCAL ROLE service_role`);
    await client.query(`SELECT public.set_kitchen_status($1, 'served')`, [orderId]);
    await client.query(`RESET ROLE`);

    const finalBaseline = await client.query(
      `SELECT served_quantity
       FROM public.order_kitchen_served_quantities
       WHERE order_id=$1 AND order_item_id=$2`,
      [orderId, itemId],
    );
    expect(Number(finalBaseline.rows[0]?.served_quantity)).toBe(3);
  });

  it('benchmarks REAL send_to_kitchen with 1/5/20/50 units before/after shared FIFO helper deltas', async () => {
    // This is rollback-only local CI: no physical tickets, no production order.
    // Stage B touches shared raw FIFO helpers, NOT send_to_kitchen itself.
    const stage = readFileSync('scripts/experiments/raw_stock_official_balance_delta_candidate_20261012.sql', 'utf8');
    const reviewProduct = randomUUID();
    await client.query(
      "INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,'FIFO Kitchen Load',$2,100,10,true)",
      [reviewProduct, branchId],
    );
    await client.query(
      "INSERT INTO public.inventory_batches(product_id,warehouse_id,branch_id,quantity,unit_cost) VALUES($1,$2,$3,100,10)",
      [reviewProduct, warehouseId, branchId],
    );
    await client.query(
      "INSERT INTO public.inventory(product_id,warehouse_id,branch_id,quantity) VALUES($1,$2,$3,100)",
      [reviewProduct, warehouseId, branchId],
    );
    const rawId = await attachDirectRawComponentToProduct(client, reviewProduct, branchId, warehouseId, 100, 10, 1);
    const readState = async (orderId: string) => {
      const r = await client.query<{
        stock: string; official: string | null; sends: string; events: string; ledger: string;
      }>(
        `SELECT
           (SELECT COALESCE(sum(quantity),0)::text FROM public.raw_material_batches
             WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3) stock,
           (SELECT quantity::text FROM public.raw_material_inventory
             WHERE raw_material_id=$1 AND branch_id=$2) official,
           (SELECT count(*)::text FROM public.order_kitchen_sends WHERE order_id=$4) sends,
           (SELECT count(*)::text FROM public.order_kitchen_inventory_events WHERE order_id=$4) events,
           (SELECT count(*)::text FROM public.inventory_ledger
             WHERE raw_material_id=$1 AND branch_id=$2 AND quantity<0) ledger`,
        [rawId, branchId, warehouseId, orderId],
      );
      return r.rows[0];
    };
    const sendMeasured = async (orderId: string) => {
      const r = await asCashier(async () =>
        client.query<{ 'QUERY PLAN': Array<Record<string, unknown>> }>(
          'EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) SELECT public.send_to_kitchen($1)',
          [orderId],
        ),
      );
      const envelope = r.rows[0]['QUERY PLAN'][0];
      const plan = (envelope.Plan || {}) as Record<string, number>;
      return {
        ms: Number(envelope['Execution Time'] || 0),
        sharedHits: Number(plan['Shared Hit Blocks'] || 0),
        walRecords: Number(plan['WAL Records'] || 0),
        walBytes: Number(plan['WAL Bytes'] || 0),
      };
    };
    const samples = [];
    for (const quantity of [1, 5, 20, 50]) {
      await client.query('SAVEPOINT fifo_kitchen_case');
      const created = await asCashier(async () => {
        const cart = JSON.stringify([{
          product_id: reviewProduct, unit_name: 'piece', quantity, unit_price: 100,
          discount_amount: 0, bonus_quantity: 0, total: quantity * 100,
        }]);
        const r = await client.query(
          "SELECT public.create_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,$3,0,'amount',0,$3,$4) AS r",
          [branchId, cart, quantity * 100, cashierId],
        );
        return r.rows[0].r;
      });
      expect(created.success).toBe(true);
      const orderId = String(created.order_id);
      await client.query('SAVEPOINT fifo_kitchen_send');
      const baseline = await sendMeasured(orderId);
      const beforeState = await readState(orderId);
      expect(Number(beforeState.stock)).toBe(100 - quantity);
      expect(Number(beforeState.sends)).toBe(1);
      expect(Number(beforeState.events)).toBeGreaterThanOrEqual(1);

      await client.query('ROLLBACK TO SAVEPOINT fifo_kitchen_send');
      await client.query(stage);
      const optimized = await sendMeasured(orderId);
      const afterState = await readState(orderId);
      expect(afterState).toEqual(beforeState);

      // A repeated kitchen send must not consume inventory again.
      const retried = await send(orderId);
      expect(retried.success).toBe(true);
      expect(retried.items_sent_count).toBe(0);
      expect(await readState(orderId)).toEqual(afterState);

      samples.push({ quantity, baseline, optimized });
      await client.query('ROLLBACK TO SAVEPOINT fifo_kitchen_case');
    }
    console.info('RAW_FIFO_REAL_KITCHEN_FACTORIAL_LOCAL', JSON.stringify({
      scope: 'Actual send_to_kitchen RPC, staged warehouse-aware stock delta only; local rollback-only',
      samples,
      caution: 'One sample per size. No production, concurrent load, full-sale payment or print latency.',
    }));
  }, 120000);

});
