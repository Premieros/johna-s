import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export async function attachRawComponentToUnit(
  client: pg.Client,
  unitId: string,
  branchId: string,
  warehouseId: string,
  initialQty = 100,
  unitCost = 0,
): Promise<string> {
  const existing = await client.query<{ raw_material_id: string }>(
    `SELECT iur.raw_material_id::text
       FROM public.inventory_unit_recipes iur
      WHERE iur.unit_id=$1
      ORDER BY iur.id
      LIMIT 1`,
    [unitId],
  );
  if (existing.rows[0]?.raw_material_id) return existing.rows[0].raw_material_id;

  const rawId = randomUUID();
  await client.query(
    `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
     SELECT $1,$2,iu.name || ' raw',$3,$4,true
       FROM public.inventory_units iu
      WHERE iu.id=$5`,
    [rawId, `TEST-RAW-${randomUUID()}`, branchId, unitCost, unitId],
  );
  await client.query(
    `INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent)
     VALUES($1,$2,1,0)`,
    [unitId, rawId],
  );
  await client.query(
    `INSERT INTO public.raw_material_batches(
       raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost
     ) VALUES($1,$2,$3,$4,$5,$6)`,
    [rawId, branchId, warehouseId, `TEST-${randomUUID()}`, initialQty, unitCost],
  );
  return rawId;
}

export async function attachDirectRawComponentToProduct(
  client: pg.Client,
  productId: string,
  branchId: string,
  warehouseId: string,
  initialQty = 100,
  unitCost = 0,
  quantityPerSale = 1,
): Promise<string> {
  const existing = await client.query<{ raw_material_id: string }>(
    `SELECT ri.raw_material_id::text
       FROM public.recipes r
       JOIN public.recipe_items ri ON ri.recipe_id=r.id
      WHERE r.product_id=$1
        AND r.branch_id=$2
        AND COALESCE(r.is_active,true)
      ORDER BY COALESCE(r.version,1) DESC,r.created_at DESC,ri.id
      LIMIT 1`,
    [productId, branchId],
  );
  if (existing.rows[0]?.raw_material_id) return existing.rows[0].raw_material_id;

  const rawId = randomUUID();
  const recipeId = randomUUID();
  await client.query(
    `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
     SELECT $1,$2,p.name || ' raw',$3,$4,true
       FROM public.products p
      WHERE p.id=$5`,
    [rawId, `TEST-RAW-${randomUUID()}`, branchId, unitCost, productId],
  );
  await client.query(
    `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
     VALUES($1,$2,$3,$4,1,true)`,
    [recipeId, productId, branchId, 'Test direct raw composition'],
  );
  await client.query(
    `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
     VALUES($1,$2,$3,0)`,
    [recipeId, rawId, quantityPerSale],
  );
  await client.query(
    `INSERT INTO public.raw_material_batches(
       raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost
     ) VALUES($1,$2,$3,$4,$5,$6)`,
    [rawId, branchId, warehouseId, `TEST-${randomUUID()}`, initialQty, unitCost],
  );
  return rawId;
}

export async function rawQtyForUnit(
  client: pg.Client,
  unitId: string,
  branchId: string,
  warehouseId: string,
): Promise<number> {
  const r = await client.query<{ quantity: string }>(
    `SELECT COALESCE(sum(rmb.quantity),0)::text AS quantity
       FROM public.inventory_unit_recipes iur
       JOIN public.raw_material_batches rmb
         ON rmb.raw_material_id=iur.raw_material_id
        AND rmb.branch_id=$2
        AND rmb.warehouse_id=$3
      WHERE iur.unit_id=$1`,
    [unitId, branchId, warehouseId],
  );
  return Number(r.rows[0]?.quantity || 0);
}

export async function rawQtyForProduct(
  client: pg.Client,
  productId: string,
  branchId: string,
  warehouseId: string,
): Promise<number> {
  const r = await client.query<{ quantity: string }>(
    `SELECT COALESCE(sum(rmb.quantity),0)::text AS quantity
       FROM public.recipes r
       JOIN public.recipe_items ri ON ri.recipe_id=r.id
       JOIN public.raw_material_batches rmb
         ON rmb.raw_material_id=ri.raw_material_id
        AND rmb.branch_id=$2
        AND rmb.warehouse_id=$3
      WHERE r.product_id=$1
        AND r.branch_id=$2
        AND COALESCE(r.is_active,true)`,
    [productId, branchId, warehouseId],
  );
  return Number(r.rows[0]?.quantity || 0);
}
