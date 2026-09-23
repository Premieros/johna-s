import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { attachRawComponentToUnit, rawQtyForUnit } from './componentTestFixtures';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  sale_id?: string;
  items_sent_count?: number;
};

describe.skipIf(skip)('Burger modifier transactional lifecycle', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;

  const productId = randomUUID();
  const pattyUnit = randomUUID();
  const cheeseUnit = randomUUID();
  const onionUnit = randomUUID();
  const sizeGroup = randomUUID();
  const extrasGroup = randomUUID();
  const singleOption = randomUUID();
  const doubleOption = randomUUID();
  const extraCheeseOption = randomUUID();
  const noOnionOption = randomUUID();

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<RpcResult> => {
    const rows = await asUser(userId, sql, params);
    return (rows[0]?.r || {}) as RpcResult;
  };

  const unitQty = async (unitId: string): Promise<number> =>
    rawQtyForUnit(client, unitId, ids.branchA, ids.whA);

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    // The shared RLS fixture adds warehouses used only for isolation probes.
    // Make the warehouse holding this lifecycle's stock the explicit kitchen
    // warehouse instead of relying on created_at/UUID tie-breaking.
    await client.query(
      `UPDATE public.warehouses SET is_default = (id = $1::uuid) WHERE branch_id = $2::uuid`,
      [ids.whA, ids.branchA],
    );

    await client.query(`UPDATE public.shifts SET status='closed', closed_at=now() WHERE id=$1`, [ids.shiftA]);
    await client.query(`UPDATE public.settings SET tax_enabled=false, tax_rate=0`);

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,cost_price,sale_price,is_active)
       VALUES($1,'Burger Modifier Gate',$2,40,100,true)`,
      [productId, ids.branchA],
    );

    const units = [
      [pattyUnit, `PATTY-${randomUUID()}`, 'Burger Patty'],
      [cheeseUnit, `CHEESE-${randomUUID()}`, 'Cheese Slice'],
      [onionUnit, `ONION-${randomUUID()}`, 'Onion Portion'],
    ];
    for (const [id, code, name] of units) {
      await client.query(
        `INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
         VALUES($1,$2,$3,'ready',$4,1,1,true)`,
        [id, code, name, ids.branchA],
      );
      await client.query(
        `INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)`,
        [productId, id],
      );
      await client.query(
        `INSERT INTO public.inventory_unit_batches(unit_id,branch_id,warehouse_id,quantity,unit_cost)
         VALUES($1,$2,$3,10,1)`,
        [id, ids.branchA, ids.whA],
      );
      await attachRawComponentToUnit(client, id, ids.branchA, ids.whA, 10, 1);
    }

    await client.query(
      `INSERT INTO public.product_modifier_groups
         (id,branch_id,product_id,name,name_en,min_selections,max_selections,sort_order,is_active)
       VALUES
         ($1,$2,$3,'الحجم','Size',1,1,0,true),
         ($4,$2,$3,'إضافات','Extras',0,2,1,true)`,
      [sizeGroup, ids.branchA, productId, extrasGroup],
    );
    await client.query(
      `INSERT INTO public.product_modifier_options
         (id,branch_id,group_id,name,name_en,price_delta,is_default,sort_order,is_active)
       VALUES
         ($1,$5,$6,'سنجل','Single',0,true,0,true),
         ($2,$5,$6,'دبل','Double',35,false,1,true),
         ($3,$5,$7,'جبنة إضافية','Extra Cheese',10,false,0,true),
         ($4,$5,$7,'بدون بصل','No Onion',0,false,1,true)`,
      [singleOption, doubleOption, extraCheeseOption, noOnionOption, ids.branchA, sizeGroup, extrasGroup],
    );
    await client.query(
      `INSERT INTO public.product_modifier_inventory_effects
         (branch_id,option_id,target_type,inventory_unit_id,quantity_delta)
       VALUES
         ($1,$2,'inventory_unit',$3,1),
         ($1,$4,'inventory_unit',$5,1),
         ($1,$6,'inventory_unit',$7,-1)`,
      [ids.branchA, doubleOption, pattyUnit, extraCheeseOption, cheeseUnit, noOnionOption, onionUnit],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('deducts exact Single/Double composition at KDS send, settles once, and refunds the exact line', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const open = await rpc(ids.users.cashier, `SELECT public.open_shift($1,0,$2) AS r`, [ids.branchA, 'Modifier burger gate']);
    expect(open.success).toBe(true);
    const shift = await client.query<{ id: string }>(
      `SELECT id FROM public.shifts WHERE branch_id=$1 AND cashier_id=$2 AND status='open' ORDER BY opened_at DESC LIMIT 1`,
      [ids.branchA, ids.users.cashier],
    );
    const shiftId = shift.rows[0].id;

    const singleMods = [singleOption, extraCheeseOption];
    const doubleMods = [doubleOption, noOnionOption];
    const items = JSON.stringify([
      {
        product_id: productId,
        unit_name: 'piece',
        quantity: 1,
        unit_price: 9999,
        discount_amount: 0,
        bonus_quantity: 0,
        total: 9999,
        modifier_option_ids: singleMods,
        notes: 'single-extra-cheese',
      },
      {
        product_id: productId,
        unit_name: 'piece',
        quantity: 1,
        unit_price: 1,
        discount_amount: 0,
        bonus_quantity: 0,
        total: 1,
        modifier_option_ids: doubleMods,
        notes: 'double-no-onion',
      },
    ]);

    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_order($1,'takeaway',NULL,NULL,NULL,NULL,$2::jsonb,10000,0,'amount',0,10000,$3) AS r`,
      [ids.branchA, items, ids.users.cashier],
    );
    expect(created.success, JSON.stringify(created)).toBe(true);
    const orderId = String(created.order_id);

    const priced = await client.query<{ notes: string; unit_price: string; modifiers_snapshot: unknown }>(
      `SELECT notes,unit_price::text,modifiers_snapshot
         FROM public.order_items WHERE order_id=$1 ORDER BY notes`,
      [orderId],
    );
    expect(priced.rows).toHaveLength(2);
    const byNote = Object.fromEntries(priced.rows.map((r) => [r.notes, r]));
    expect(Number(byNote['single-extra-cheese'].unit_price)).toBe(110);
    expect(Number(byNote['double-no-onion'].unit_price)).toBe(135);
    expect(JSON.stringify(byNote['single-extra-cheese'].modifiers_snapshot)).toContain('Extra Cheese');
    expect(JSON.stringify(byNote['double-no-onion'].modifiers_snapshot)).toContain('Double');

    const before = {
      patty: await unitQty(pattyUnit),
      cheese: await unitQty(cheeseUnit),
      onion: await unitQty(onionUnit),
    };
    const sent = await rpc(ids.users.cashier, `SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(sent.success, JSON.stringify(sent)).toBe(true);
    expect(sent.items_sent_count).toBe(2);
    expect(await unitQty(pattyUnit)).toBe(before.patty - 3);
    expect(await unitQty(cheeseUnit)).toBe(before.cheese - 3);
    expect(await unitQty(onionUnit)).toBe(before.onion - 1);

    const invoice = `MOD-${Date.now()}-${randomUUID().slice(0,8)}`;
    const sale = await rpc(
      ids.users.cashier,
      `SELECT public.process_sale(
         p_invoice_number := $1,
         p_branch_id := $2,
         p_shift_id := $3,
         p_warehouse_id := $4,
         p_customer_id := NULL,
         p_salesperson_id := $5,
         p_subtotal := 9999,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 0,
         p_bonus_amount := 0,
         p_total := 9999,
         p_paid_amount := 9999,
         p_payment_method := 'cash',
         p_status := 'completed',
         p_items := $6::jsonb,
         p_order_type := 'takeaway',
         p_table_id := NULL,
         p_order_id := $7
       ) AS r`,
      [invoice, ids.branchA, shiftId, ids.whA, ids.users.cashier, items, orderId],
    );
    expect(sale.success, JSON.stringify(sale)).toBe(true);
    const saleId = String(sale.sale_id);

    const saleRow = await client.query<{ total: string }>(`SELECT total::text FROM public.sales WHERE id=$1`, [saleId]);
    expect(Number(saleRow.rows[0].total)).toBe(245);
    expect(await unitQty(pattyUnit)).toBe(before.patty - 3);
    expect(await unitQty(cheeseUnit)).toBe(before.cheese - 3);
    expect(await unitQty(onionUnit)).toBe(before.onion - 1);

    const saleItems = await client.query<{ id: string; modifiers_snapshot: unknown; total: string }>(
      `SELECT id,modifiers_snapshot,total::text FROM public.sale_items WHERE sale_id=$1 ORDER BY id`,
      [saleId],
    );
    const singleItem = saleItems.rows.find((r) => {
      const snapshot = JSON.stringify(r.modifiers_snapshot);
      return snapshot.includes('Single') && snapshot.includes('Extra Cheese');
    });
    expect(singleItem).toBeTruthy();
    expect(Number(singleItem!.total)).toBe(110);

    const effectRows = await client.query<{ target_id: string; quantity: string }>(
      `SELECT target_id::text,quantity::text FROM public.sale_item_inventory_effects WHERE sale_item_id=$1`,
      [singleItem!.id],
    );
    const effects = Object.fromEntries(effectRows.rows.map((r) => [r.target_id, Number(r.quantity)]));
    expect(effects[pattyUnit]).toBe(1);
    expect(effects[cheeseUnit]).toBe(2);
    expect(effects[onionUnit]).toBe(1);

    const refundItems = JSON.stringify([{ sale_item_id: singleItem!.id, quantity: 1 }]);
    const refunded = await rpc(
      ids.users.branch_manager,
      `SELECT public.process_refund($1,$2::jsonb,$3) AS r`,
      [saleId, refundItems, 'Exact modifier line partial refund'],
    );
    expect(refunded.success, JSON.stringify(refunded)).toBe(true);

    // Only the Single + Extra Cheese line is restored. Double + No Onion remains consumed.
    expect(await unitQty(pattyUnit)).toBe(before.patty - 2);
    expect(await unitQty(cheeseUnit)).toBe(before.cheese - 1);
    expect(await unitQty(onionUnit)).toBe(before.onion);
  });
});
