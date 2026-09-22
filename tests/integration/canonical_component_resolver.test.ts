import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('canonical product raw component resolver', () => {
  let client: pg.Client;

  const branchId = randomUUID();
  const otherBranchId = randomUUID();

  const productId = randomUUID();
  const recipeId = randomUUID();

  const rawDirect = randomUUID();
  const rawPlaceholder = randomUUID();
  const rawGroup = randomUUID();
  const rawNested = randomUUID();

  const groupParent = randomUUID();
  const groupChild = randomUUID();

  const cycleProduct = randomUUID();
  const cycleA = randomUUID();
  const cycleB = randomUUID();

  const mismatchProduct = randomUUID();
  const nestedMismatchProduct = randomUUID();
  const localNestedParent = randomUUID();
  const foreignGroup = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES
       ($1,'QA Components A'),
       ($2,'QA Components B')`,
      [branchId, otherBranchId],
    );

    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES
       ($1,$2,'Direct Raw',$5,1,true),
       ($3,$4,'Sauce Group',$5,1,true),
       ($6,$7,'Group Raw',$5,1,true),
       ($8,$9,'Nested Raw',$5,1,true)`,
      [
        rawDirect, `R-${randomUUID()}`,
        rawPlaceholder, `R-${randomUUID()}`,
        branchId,
        rawGroup, `R-${randomUUID()}`,
        rawNested, `R-${randomUUID()}`,
      ],
    );

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES
       ($1,'QA Canonical Product',$2,10,0,true),
       ($3,'QA Cycle Product',$2,10,0,true),
       ($4,'QA Mismatch Product',$2,10,0,true),
       ($5,'QA Nested Mismatch Product',$2,10,0,true)`,
      [productId, branchId, cycleProduct, mismatchProduct, nestedMismatchProduct],
    );

    await client.query(
      `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES($1,$2,$3,'Legacy direct composition',2,true)`,
      [recipeId, productId, branchId],
    );

    await client.query(
      `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES
       ($1,$2,2,0),
       ($1,$3,2,0)`,
      [recipeId, rawDirect, rawPlaceholder],
    );

    await client.query(
      `INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,is_active) VALUES
       ($1,$2,'Sauce Group','manufactured',$7,true),
       ($3,$4,'Nested Group','manufactured',$7,true),
       ($5,$6,'Cycle A','manufactured',$7,true),
       ($8,$9,'Cycle B','manufactured',$7,true),
       ($10,$11,'Foreign Group','manufactured',$12,true),
       ($13,$14,'Local Nested Parent','manufactured',$7,true)`,
      [
        groupParent, `U-${randomUUID()}`,
        groupChild, `U-${randomUUID()}`,
        cycleA, `U-${randomUUID()}`,
        branchId,
        cycleB, `U-${randomUUID()}`,
        foreignGroup, `U-${randomUUID()}`,
        otherBranchId,
        localNestedParent, `U-${randomUUID()}`,
      ],
    );

    await client.query(
      `INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES
       ($1,$2,2),
       ($3,$4,1),
       ($5,$6,1),
       ($7,$8,1)`,
      [productId, groupParent, cycleProduct, cycleA, mismatchProduct, foreignGroup, nestedMismatchProduct, localNestedParent],
    );

    await client.query(
      `INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent) VALUES
       ($1,$2,3,10),
       ($3,$4,4,25)`,
      [groupParent, rawGroup, groupChild, rawNested],
    );

    await client.query(
      `INSERT INTO public.inventory_unit_recipe_units(unit_id,component_unit_id,quantity,wastage_percent) VALUES
       ($1,$2,0.5,20),
       ($3,$4,1,0),
       ($4,$3,1,0),
       ($5,$6,1,0)`,
      [groupParent, groupChild, cycleA, cycleB, localNestedParent, foreignGroup],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('flattens every explicit direct raw plus reusable and nested groups without manufacturing', async () => {
    const before = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.inventory_unit_productions
       WHERE unit_id = ANY($1::uuid[])`,
      [[groupParent, groupChild]],
    );

    const resolved = await client.query<{
      raw_material_id: string;
      raw_name: string;
      quantity_per_sale: string;
    }>(
      `SELECT raw_material_id::text,raw_name,quantity_per_sale::text
       FROM public.resolve_product_raw_components($1,$2)
       ORDER BY raw_name`,
      [productId, branchId],
    );

    const byId = new Map(resolved.rows.map((row) => [row.raw_material_id, Number(row.quantity_per_sale)]));

    expect(resolved.rows).toHaveLength(4);
    expect(byId.get(rawDirect)).toBeCloseTo(1, 6);
    expect(byId.get(rawGroup)).toBeCloseTo(6.6, 6);
    expect(byId.get(rawNested)).toBeCloseTo(6, 6);
    expect(byId.get(rawPlaceholder)).toBeCloseTo(1, 6);

    const after = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.inventory_unit_productions
       WHERE unit_id = ANY($1::uuid[])`,
      [[groupParent, groupChild]],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('rejects a nested component cycle instead of recursing forever', async () => {
    await expect(
      client.query(
        'SELECT * FROM public.resolve_product_raw_components($1,$2)',
        [cycleProduct, branchId],
      ),
    ).rejects.toThrow(/COMPONENT_GROUP_CYCLE/);
  });

  it('rejects a product link to a component group from another branch', async () => {
    await expect(
      client.query(
        'SELECT * FROM public.resolve_product_raw_components($1,$2)',
        [mismatchProduct, branchId],
      ),
    ).rejects.toThrow(/COMPONENT_GROUP_NOT_IN_BRANCH/);
  });

  it('rejects a nested component group from another branch instead of silently skipping it', async () => {
    await expect(
      client.query(
        'SELECT * FROM public.resolve_product_raw_components($1,$2)',
        [nestedMismatchProduct, branchId],
      ),
    ).rejects.toThrow(/COMPONENT_GROUP_NOT_IN_BRANCH/);
  });
});
