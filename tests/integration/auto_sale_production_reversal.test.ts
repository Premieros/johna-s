import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown) => Number(v || 0);

type Rpc = {
  success?: boolean;
  restored_quantity?: number | string;
  auto_production_quantity_reversed?: number | string;
  unit_quantity_restored?: number | string;
  [key: string]: unknown;
};

describe.skipIf(skip)('AUTO_SALE_PRODUCTION exact source reversal', () => {
  let client: pg.Client;

  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const measurementUnitId = randomUUID();

  const rawDirect = randomUUID();
  const unitDirect = randomUUID();
  const productDirect = randomUUID();

  const rawKitchen = randomUUID();
  const unitKitchen = randomUUID();
  const productKitchen = randomUUID();

  const rawNested = randomUUID();
  const childUnit = randomUUID();
  const parentUnit = randomUUID();
  const nestedProduct = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function rawBalance(rawId: string) {
    const rows = await q<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text AS qty
       FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [rawId, branchId, warehouseId],
    );
    return num(rows[0].qty);
  }

  async function unitBalance(unitId: string) {
    const rows = await q<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text AS qty
       FROM public.inventory_unit_batches
       WHERE unit_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [unitId, branchId, warehouseId],
    );
    return num(rows[0].qty);
  }

  async function addRaw(rawId: string, qty: number) {
    const refId = randomUUID();
    const rows = await q<{ r: Rpc }>(
      `SELECT public._raw_add(
         $1,$2,$3,$4,1,NULL,NULL,NULL,
         'purchase_receipt','purchase_receipt',$5,$6,NULL
       ) AS r`,
      [rawId, branchId, warehouseId, qty, refId, `SRC-${refId.slice(0, 8)}`],
    );
    expect(rows[0].r.success).toBe(true);
  }

  async function consume(productId: string, refId: string, qty = 1) {
    const rows = await q<{ r: Rpc }>(
      `SELECT public._deduct_sale_inventory_with_modifiers_core(
         $1,$2,$3::jsonb,$4,$5
       ) AS r`,
      [branchId, warehouseId, JSON.stringify([{ product_id: productId, quantity: qty }]), refId, `SALE-${refId.slice(0, 8)}`],
    );
    expect(rows[0].r.success).toBe(true);
    return rows[0].r;
  }

  async function restoreSource(referenceType: string, referenceId: string, unitId: string, qty: number) {
    const rows = await q<{ r: Rpc }>(
      `SELECT public._restore_inventory_unit_consumption_source(
        $1,$2,$3,$4,$5,$6,
        'refund','sale',$2,'TEST-REV',NULL,NULL
      ) AS r`,
      [referenceType, referenceId, unitId, branchId, warehouseId, qty],
    );
    expect(rows[0].r.success).toBe(true);
    return rows[0].r;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES($1,'Auto reversal test')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active)
       VALUES($1,'Auto reversal WH',$2,true)`,
      [warehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active)
       VALUES($1,$2,'Kilogram','kg',true)`,
      [measurementUnitId, `AR-${randomUUID().slice(0, 8)}`],
    );

    for (const [rawId, suffix] of [
      [rawDirect, 'DIRECT'],
      [rawKitchen, 'KITCHEN'],
      [rawNested, 'NESTED'],
    ] as const) {
      await client.query(
        `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
         VALUES($1,$2,$3,$4,$5,1,true)`,
        [rawId, `AR-${suffix}-${randomUUID().slice(0, 6)}`, `Raw ${suffix}`, branchId, measurementUnitId],
      );
    }

    for (const [unitId, name] of [
      [unitDirect, 'Manufactured Direct'],
      [unitKitchen, 'Manufactured Kitchen'],
      [childUnit, 'Manufactured Child'],
      [parentUnit, 'Manufactured Parent'],
    ] as const) {
      await client.query(
        `INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,is_active)
         VALUES($1,$2,$3,'manufactured',$4,true)`,
        [unitId, `AU-${randomUUID().slice(0, 8)}`, name, branchId],
      );
    }

    for (const [productId, unitId, name] of [
      [productDirect, unitDirect, 'Product Direct'],
      [productKitchen, unitKitchen, 'Product Kitchen'],
      [nestedProduct, parentUnit, 'Product Nested'],
    ] as const) {
      await client.query(
        `INSERT INTO public.products(id,name,branch_id,product_type,sale_price,cost_price,is_active)
         VALUES($1,$2,$3,'manufactured',10,1,true)`,
        [productId, name, branchId],
      );
      await client.query(
        `INSERT INTO public.product_unit_links(product_id,unit_id,quantity)
         VALUES($1,$2,1)`,
        [productId, unitId],
      );
    }

    await client.query(
      `INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$2,1,0),($3,$4,1,0)`,
      [unitDirect, rawDirect, unitKitchen, rawKitchen],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$2,1,0)`,
      [childUnit, rawNested],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipe_units(unit_id,component_unit_id,quantity,wastage_percent)
       VALUES($1,$2,1,0)`,
      [parentUnit, childUnit],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('reverses direct-sale auto production back to raw materials and stays idempotent', async () => {
    const saleRef = randomUUID();
    await consume(productDirect, saleRef, 1);

    expect(await rawBalance(rawDirect)).toBe(-1);
    expect(await unitBalance(unitDirect)).toBe(0);

    const first = await restoreSource('sale', saleRef, unitDirect, 1);
    expect(num(first.restored_quantity)).toBe(1);
    expect(num(first.auto_production_quantity_reversed)).toBe(1);
    expect(num(first.unit_quantity_restored)).toBe(0);
    expect(await rawBalance(rawDirect)).toBe(0);
    expect(await unitBalance(unitDirect)).toBe(0);

    const second = await restoreSource('sale', saleRef, unitDirect, 1);
    expect(num(second.restored_quantity)).toBe(0);
    expect(await rawBalance(rawDirect)).toBe(0);
    expect(await unitBalance(unitDirect)).toBe(0);
  });

  it('returns pre-existing manufactured stock as a manufactured unit, not raw materials', async () => {
    await addRaw(rawDirect, 1);
    const production = await q<{ id: string }>(
      `SELECT public._produce_inventory_unit_internal(
        $1,1,$2,$3,'MANUAL_TEST',false
      )::text AS id`,
      [unitDirect, warehouseId, branchId],
    );
    expect(production[0].id).toBeTruthy();
    expect(await rawBalance(rawDirect)).toBe(0);
    expect(await unitBalance(unitDirect)).toBe(1);

    const saleRef = randomUUID();
    await consume(productDirect, saleRef, 1);
    expect(await unitBalance(unitDirect)).toBe(0);

    const restored = await restoreSource('sale', saleRef, unitDirect, 1);
    expect(num(restored.unit_quantity_restored)).toBe(1);
    expect(num(restored.auto_production_quantity_reversed)).toBe(0);
    expect(await rawBalance(rawDirect)).toBe(0);
    expect(await unitBalance(unitDirect)).toBe(1);
  });

  it('kitchen void reverses an auto-produced unit back to its raw source', async () => {
    const eventId = randomUUID();
    await consume(productKitchen, eventId, 1);
    expect(await rawBalance(rawKitchen)).toBe(-1);
    expect(await unitBalance(unitKitchen)).toBe(0);

    await client.query(
      `UPDATE public.inventory_unit_entries
       SET entry_type='kitchen_send',reference_type='kitchen_send'
       WHERE reference_id=$1 AND entry_type='sale' AND reference_type='sale'`,
      [eventId],
    );

    const orderId = randomUUID();
    const orderItemId = randomUUID();
    await client.query(
      `INSERT INTO public.orders(id,order_number,branch_id,status,kitchen_status,station,inventory_warehouse_id)
       VALUES($1,$2,$3,'open','sent','main',$4)`,
      [orderId, `AUTO-K-${randomUUID().slice(0, 8)}`, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events(
         id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,voided_quantity,total_cost
       ) VALUES($1,$2,$3,$4,$5,1,0,0)`,
      [eventId, branchId, warehouseId, orderId, orderItemId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_effects(
         event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost
       ) VALUES($1,$2,$3,'inventory_unit',$4,1,0)`,
      [eventId, branchId, warehouseId, unitKitchen],
    );

    const rows = await q<{ r: Rpc }>(
      `SELECT public._restore_kitchen_inventory_for_void($1,$2,1) AS r`,
      [orderId, orderItemId],
    );
    expect(rows[0].r.success).toBe(true);
    expect(await rawBalance(rawKitchen)).toBe(0);
    expect(await unitBalance(unitKitchen)).toBe(0);
  });

  it('recursively reverses nested auto-produced manufactured components to the original raw', async () => {
    const saleRef = randomUUID();
    await consume(nestedProduct, saleRef, 1);

    expect(await rawBalance(rawNested)).toBe(-1);
    expect(await unitBalance(childUnit)).toBe(0);
    expect(await unitBalance(parentUnit)).toBe(0);

    const restored = await restoreSource('sale', saleRef, parentUnit, 1);
    expect(num(restored.auto_production_quantity_reversed)).toBe(1);
    expect(await rawBalance(rawNested)).toBe(0);
    expect(await unitBalance(childUnit)).toBe(0);
    expect(await unitBalance(parentUnit)).toBe(0);

    const reversed = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.auto_sale_production_reversals
       WHERE reversed_quantity=1`,
    );
    expect(num(reversed[0].count)).toBeGreaterThanOrEqual(2);
  });
});
