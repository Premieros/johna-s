import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Phase 4 snapshot void/refund reversal', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();

  async function rawQty(rawId: string): Promise<number> {
    const r = await client.query<{ q: string }>(
      `SELECT COALESCE(sum(quantity),0)::text q
         FROM public.raw_material_batches
        WHERE raw_material_id=$1
          AND branch_id=$2
          AND warehouse_id=$3`,
      [rawId, branchId, warehouseId],
    );
    return Number(r.rows[0]?.q || 0);
  }

  async function makeRaw(name: string, qty: number): Promise<string> {
    const rawId = randomUUID();
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
       VALUES($1,$2,$3,$4,5,true)`,
      [rawId, `P4-${randomUUID()}`, name, branchId],
    );
    if (qty !== 0) {
      await client.query(
        `INSERT INTO public.raw_material_batches(
           raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost
         ) VALUES($1,$2,$3,$4,$5,5)`,
        [rawId, branchId, warehouseId, `P4-B-${randomUUID()}`, qty],
      );
    }
    return rawId;
  }

  async function makeProductWithCurrentRecipe(rawId: string, name: string): Promise<string> {
    const productId = randomUUID();
    const recipeId = randomUUID();
    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active)
       VALUES($1,$2,$3,100,0,true)`,
      [productId, name, branchId],
    );
    await client.query(
      `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES($1,$2,$3,$4,1,true)`,
      [recipeId, productId, branchId, 'Current changed recipe'],
    );
    await client.query(
      `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$2,9,0)`,
      [recipeId, rawId],
    );
    return productId;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.branches(id,name) VALUES($1,'Phase 4 Branch')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default)
       VALUES($1,'Phase 4 WH',$2,true,true)`,
      [warehouseId, branchId],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('void restores the v2 snapshot even after the current recipe changes', async () => {
    const originalRaw = await makeRaw('Original Void Raw', 8);
    const currentRecipeRaw = await makeRaw('Changed Void Raw', 0);
    const productId = await makeProductWithCurrentRecipe(currentRecipeRaw, 'Void Snapshot Product');

    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const eventId = randomUUID();

    await client.query(
      `INSERT INTO public.orders(
         id,order_number,branch_id,order_type,status,kitchen_status,inventory_warehouse_id
       ) VALUES($1,$2,$3,'takeaway','open','sent',$4)`,
      [orderId, `P4-V-${randomUUID()}`, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price,total)
       VALUES($1,$2,$3,1,100,100)`,
      [orderItemId, orderId, productId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events(
         id,branch_id,warehouse_id,order_id,order_item_id,
         sent_quantity,voided_quantity,total_cost,component_snapshot,snapshot_version
       ) VALUES(
         $1,$2,$3,$4,$5,1,0,10,
         jsonb_build_array(jsonb_build_object(
           'raw_material_id',$6::text,
           'raw_name','Original Void Raw',
           'quantity',2
         )),
         2
       )`,
      [eventId, branchId, warehouseId, orderId, orderItemId, originalRaw],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_effects(
         event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost
       ) VALUES($1,$2,$3,'raw_material',$4,2,10)`,
      [eventId, branchId, warehouseId, originalRaw],
    );

    const beforeChanged = await rawQty(currentRecipeRaw);
    const restored = await client.query<{ r: { success: boolean; restored_sent_quantity?: number } }>(
      `SELECT public._restore_kitchen_inventory_for_void($1,$2,1) AS r`,
      [orderId, orderItemId],
    );

    expect(restored.rows[0].r.success, JSON.stringify(restored.rows[0].r)).toBe(true);
    expect(Number(restored.rows[0].r.restored_sent_quantity)).toBeCloseTo(1, 6);
    expect(await rawQty(originalRaw)).toBeCloseTo(10, 6);
    expect(await rawQty(currentRecipeRaw)).toBeCloseTo(beforeChanged, 6);

    const event = await client.query<{ voided_quantity: string }>(
      `SELECT voided_quantity::text
         FROM public.order_kitchen_inventory_events
        WHERE id=$1`,
      [eventId],
    );
    expect(Number(event.rows[0].voided_quantity)).toBeCloseTo(1, 6);
  });

  it('refund restores the settled v2 snapshot instead of current recipe/manufacturing state', async () => {
    const originalRaw = await makeRaw('Original Refund Raw', 8);
    const currentRecipeRaw = await makeRaw('Changed Refund Raw', 0);
    const productId = await makeProductWithCurrentRecipe(currentRecipeRaw, 'Refund Snapshot Product');

    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const eventId = randomUUID();
    const saleId = randomUUID();
    const saleItemId = randomUUID();

    await client.query(
      `INSERT INTO public.orders(
         id,order_number,branch_id,order_type,status,kitchen_status,inventory_warehouse_id
       ) VALUES($1,$2,$3,'takeaway','completed','sent',$4)`,
      [orderId, `P4-R-${randomUUID()}`, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price,total)
       VALUES($1,$2,$3,1,100,100)`,
      [orderItemId, orderId, productId],
    );
    await client.query(
      `INSERT INTO public.sales(
         id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,
         payment_method,status,order_type
       ) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')`,
      [saleId, `P4-S-${randomUUID()}`, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.sale_items(
         id,sale_id,product_id,quantity,unit_name,unit_price,total,source_order_item_id
       ) VALUES($1,$2,$3,1,'piece',100,100,$4)`,
      [saleItemId, saleId, productId, orderItemId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events(
         id,branch_id,warehouse_id,order_id,order_item_id,
         sent_quantity,voided_quantity,total_cost,settled_sale_id,
         component_snapshot,snapshot_version
       ) VALUES(
         $1,$2,$3,$4,$5,1,0,10,$6,
         jsonb_build_array(jsonb_build_object(
           'raw_material_id',$7::text,
           'raw_name','Original Refund Raw',
           'quantity',2
         )),
         2
       )`,
      [eventId, branchId, warehouseId, orderId, orderItemId, saleId, originalRaw],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_effects(
         event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost
       ) VALUES($1,$2,$3,'raw_material',$4,2,10)`,
      [eventId, branchId, warehouseId, originalRaw],
    );

    const beforeChanged = await rawQty(currentRecipeRaw);
    const restored = await client.query<{
      r: { success: boolean; snapshot_restored?: boolean; auto_production_reversed?: number };
    }>(
      `SELECT public._restore_refund_hybrid_inventory(
         $1,$2,$3,1,$4,$5,'P4-REFUND'
       ) AS r`,
      [saleItemId, saleId, productId, branchId, warehouseId],
    );

    expect(restored.rows[0].r.success, JSON.stringify(restored.rows[0].r)).toBe(true);
    expect(restored.rows[0].r.snapshot_restored).toBe(true);
    expect(Number(restored.rows[0].r.auto_production_reversed || 0)).toBe(0);
    expect(await rawQty(originalRaw)).toBeCloseTo(10, 6);
    expect(await rawQty(currentRecipeRaw)).toBeCloseTo(beforeChanged, 6);
  });
});
