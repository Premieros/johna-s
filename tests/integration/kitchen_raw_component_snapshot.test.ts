import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { activateApprovedBranchFixture, installApprovedRawWriterFixture } from './approvedRawWriterFixture';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip).each(['legacy','approved'] as const)('Phase 3 direct raw kitchen deduction helper (%s)', (engine) => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();
  const recipeId = randomUUID();
  const unitId = randomUUID();
  const directRawId = randomUUID();
  const groupRawId = randomUUID();
  const eventId = randomUUID();
  const unconfiguredProductId = randomUUID();
  const unconfiguredEventId = randomUUID();

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
    if (engine==='approved') await installApprovedRawWriterFixture(client,dbUrl!);

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
      'INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,$2,$3,100,0,true),($4,$5,$3,50,0,true)',
      [productId, 'Phase 3 Product', branchId, unconfiguredProductId, 'Unconfigured Kitchen Product'],
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
    if (engine==='approved') {
      await activateApprovedBranchFixture(client,branchId);
    }
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
    expect((await client.query('SELECT id FROM public.inventory_unit_batches WHERE unit_id=$1',[unitId])).rows).toEqual([]);
    if (engine==='approved') {
      expect((await client.query('SELECT id FROM public.raw_fifo_debts WHERE raw_material_id=ANY($1::uuid[])',[[directRawId,groupRawId]])).rows).toEqual([]);
      const cost=(await client.query('SELECT sum(-total_cost) cost FROM public.inventory_ledger WHERE reference_id=$1',[eventId])).rows[0].cost;
      expect(Number(cost)).toBe(4*5+6*7);
    }

    const ledger = await client.query<{ c: number }>(
      "SELECT count(*)::int c FROM public.inventory_ledger WHERE reference_id=$1 AND entry_type='kitchen_send' AND reference_type='kitchen_send'",
      [eventId],
    );
    expect(ledger.rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it('uses one actual four-decimal quantity for the ledger, physical stock and component response', async () => {
    if (engine !== 'approved') return;
    await client.query('SAVEPOINT fractional_raw');
    try {
      await client.query('UPDATE public.recipe_items SET quantity=0.166667 WHERE recipe_id=$1',[recipeId]);
      const before=await rawQty(directRawId),ref=randomUUID();
      const result=(await client.query('SELECT public._deduct_kitchen_raw_components($1,$2,$3,1,$4::jsonb,$5,$6,NULL) r',[productId,branchId,warehouseId,'[]',ref,'QA-FRACTION'])).rows[0].r;
      expect(result.success,JSON.stringify(result)).toBe(true);
      const component=result.raw_materials_deducted.find((r:{raw_material_id:string})=>r.raw_material_id===directRawId);
      expect(component.quantity).toBe(0.1667);
      expect(await rawQty(directRawId)).toBeCloseTo(before-0.1667,4);
      const ledger=(await client.query('SELECT sum(quantity) qty,sum(total_cost) cost FROM public.inventory_ledger WHERE reference_id=$1 AND raw_material_id=$2',[ref,directRawId])).rows[0];
      expect(Number(ledger.qty)).toBe(-component.quantity);
      expect(Number(ledger.cost)).toBe(-component.total_cost);
    } finally {await client.query('ROLLBACK TO fractional_raw');await client.query('RELEASE fractional_raw');}
  });
  it('creates a same-name fallback raw for an unconfigured product and records negative stock', async () => {
    const result = await client.query<{
      r: {
        success: boolean;
        raw_materials_deducted?: Array<{ raw_material_id: string; raw_name: string; quantity: number }>;
      };
    }>(
      'SELECT public._deduct_kitchen_raw_components($1,$2,$3,2,$4::jsonb,$5,$6,NULL) AS r',
      [unconfiguredProductId, branchId, warehouseId, '[]', unconfiguredEventId, 'PHASE3-FALLBACK'],
    );

    expect(result.rows[0].r.success, JSON.stringify(result.rows[0].r)).toBe(true);
    expect(result.rows[0].r.raw_materials_deducted).toHaveLength(1);

    const fallback = result.rows[0].r.raw_materials_deducted![0];
    if (engine==='approved') expect(fallback).toMatchObject({unit_cost:0,total_cost:0,price_source:'catalog_zero'});
    expect(fallback.raw_name).toBe('Unconfigured Kitchen Product');
    expect(Number(fallback.quantity)).toBeCloseTo(2, 6);

    const raw = await client.query<{ id: string; name: string; q: string }>(
      `SELECT rm.id, rm.name, COALESCE(sum(rmb.quantity),0)::text AS q
         FROM public.raw_materials rm
         LEFT JOIN public.raw_material_batches rmb
           ON rmb.raw_material_id=rm.id
          AND rmb.branch_id=rm.branch_id
          AND rmb.warehouse_id=$3
        WHERE rm.branch_id=$1
          AND rm.code=$2
        GROUP BY rm.id,rm.name`,
      [branchId, 'AUTO-PROD-' + unconfiguredProductId.replace(/-/g, ''), warehouseId],
    );

    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0].name).toBe('Unconfigured Kitchen Product');
    expect(Number(raw.rows[0].q)).toBeCloseTo(-2, 6);
    expect(raw.rows[0].id).toBe(fallback.raw_material_id);
    if (engine==='approved') expect((await client.query('SELECT id FROM public.raw_fifo_debts WHERE raw_material_id=$1',[fallback.raw_material_id])).rows).toEqual([]);
  });
});
