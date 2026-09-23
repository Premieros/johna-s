import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Phase 3 direct raw kitchen deduction helper', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();
  const recipeId = randomUUID();
  const unitId = randomUUID();
  const directRawId = randomUUID();
  const groupRawId = randomUUID();
  const eventId = randomUUID();

  async function rawQty(rawId: string): Promise<number> {
    const r = await client.query<{ q: string }>(
      'SELECT COALESCE(sum(quantity),0)::text q FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
      [rawId, branchId, warehouseId],
    );
    return Number(r.rows[0].q);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query('INSERT INTO public.branches(id,name) VALUES($1,$2)', [branchId, 'Phase 3 Branch']);
    await client.query(
      'INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,$2,$3,true,true)',
      [warehouseId, 'Phase 3 WH', branchId],
    );
    await client.query(
      'INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,$3,$4,5,true),($5,$6,$7,$4,7,true)',
      [directRawId, 'RD-' + randomUUID(), 'Direct Raw', branchId, groupRawId, 'RG-' + randomUUID(), 'Group Raw'],
    );
    await client.query(
      'INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,$2,$3,100,0,true)',
      [productId, 'Phase 3 Product', branchId],
    );
    await client.query(
      'INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active) VALUES($1,$2,$3,$4,1,true)',
      [recipeId, productId, branchId, 'Direct components'],
    );
    await client.query(
      'INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,2,0)',
      [recipeId, directRawId],
    );
    await client.query(
      'INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,cost_price,sale_price,is_active) VALUES($1,$2,$3,$4,$5,0,0,true)',
      [unitId, 'UG-' + randomUUID(), 'Reusable Group', 'manufactured', branchId],
    );
    await client.query(
      'INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,3,0)',
      [unitId, groupRawId],
    );
    await client.query(
      'INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)',
      [productId, unitId],
    );
    await client.query(
      'INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost) VALUES($1,$3,$4,$5,1,5),($2,$3,$4,$6,10,7)',
      [directRawId, groupRawId, branchId, warehouseId, 'B-' + randomUUID(), 'B-' + randomUUID()],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('flattens product and reusable group to raws, allows negative stock, and never manufactures the group', async () => {
    const beforeProduction = await client.query<{ c: number }>(
      'SELECT count(*)::int c FROM public.inventory_unit_productions WHERE unit_id=$1',
      [unitId],
    );

    const r = await client.query<{ r: { success: boolean; raw_materials_deducted?: Array<{ raw_material_id: string; quantity: number }> } }>(
      'SELECT public._deduct_kitchen_raw_components($1,$2,$3,2,$4::jsonb,$5,$6,NULL) AS r',
      [productId, branchId, warehouseId, '[]', eventId, 'PHASE3-TEST'],
    );

    expect(r.rows[0].r.success, JSON.stringify(r.rows[0].r)).toBe(true);
    expect(await rawQty(directRawId)).toBeCloseTo(-3, 6);
    expect(await rawQty(groupRawId)).toBeCloseTo(4, 6);

    const rawMap = new Map(
      (r.rows[0].r.raw_materials_deducted || []).map((row) => [row.raw_material_id, Number(row.quantity)]),
    );
    expect(rawMap.get(directRawId)).toBeCloseTo(4, 6);
    expect(rawMap.get(groupRawId)).toBeCloseTo(6, 6);

    const afterProduction = await client.query<{ c: number }>(
      'SELECT count(*)::int c FROM public.inventory_unit_productions WHERE unit_id=$1',
      [unitId],
    );
    expect(afterProduction.rows[0].c).toBe(beforeProduction.rows[0].c);

    const ledger = await client.query<{ c: number }>(
      "SELECT count(*)::int c FROM public.inventory_ledger WHERE reference_id=$1 AND entry_type='kitchen_send' AND reference_type='kitchen_send'",
      [eventId],
    );
    expect(ledger.rows[0].c).toBeGreaterThanOrEqual(2);
  });
});
