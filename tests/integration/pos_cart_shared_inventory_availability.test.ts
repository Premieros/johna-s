import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type AvailabilityRow = { product_id: string; available_quantity: string | number; is_available: boolean };

describe.skipIf(skip)('POS cart-aware shared inventory availability', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const userId = randomUUID();
  const role = `qa_cart_avail_${randomUUID().slice(0, 8)}`;
  const measurementUnitId = randomUUID();
  const rawId = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const recipeA = randomUUID();
  const recipeB = randomUUID();

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function availability(items: Array<{ product_id: string; quantity: number }>, warehouse = warehouseId) {
    return asUser(async () => {
      const result = await client.query<AvailabilityRow>(
        `SELECT product_id, available_quantity, is_available
         FROM public.get_pos_cart_product_availability($1,$2,$3::jsonb,20)
         WHERE product_id = ANY($4::uuid[])
         ORDER BY product_id`,
        [branchId, warehouse, JSON.stringify(items), [productA, productB]],
      );
      return Object.fromEntries(result.rows.map((row) => [row.product_id, Number(row.available_quantity)]));
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches(id,name) VALUES ($1,'Cart Availability Branch')`, [branchId]);
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default)
       VALUES ($1,'POS Main',$3,true,true),($2,'POS Empty',$3,true,false)`,
      [warehouseId, otherWarehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'اختبار توفر السلة','Cart availability QA','[]'::jsonb,'branch',true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES($1,$2,'Cart Availability User',$3,$4,true)`,
      [userId, `${randomUUID()}@test.local`, role, branchId],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active)
       VALUES($1,$2,'Piece','pc',true)`,
      [measurementUnitId, `PC-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
       VALUES($1,$2,'Shared Raw',$3,$4,5,true)`,
      [rawId, `RAW-${randomUUID().slice(0, 8)}`, branchId, measurementUnitId],
    );
    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active,product_type)
       VALUES($1,'Shared Product A',$3,20,5,true,'manufactured'),
             ($2,'Shared Product B',$3,20,5,true,'manufactured')`,
      [productA, productB, branchId],
    );
    await client.query(
      `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES($1,$3,$5,'Recipe A',1,true),($2,$4,$5,'Recipe B',1,true)`,
      [recipeA, recipeB, productA, productB, branchId],
    );
    await client.query(
      `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$3,1,0),($2,$3,1,0)`,
      [recipeA, recipeB, rawId],
    );

    const seeded = await client.query<{ r: { success?: boolean } }>(
      `SELECT public._raw_add($1,$2,$3,1,5,NULL,NULL,NULL,'opening','stock_count',NULL,'QA',NULL) AS r`,
      [rawId, branchId, warehouseId],
    );
    expect(seeded.rows[0].r.success).toBe(true);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('shows both products as one available before the cart consumes the shared raw material', async () => {
    const map = await availability([]);
    expect(map[productA]).toBe(1);
    expect(map[productB]).toBe(1);
  });

  it('makes every product sharing the raw material unavailable after one is added', async () => {
    const afterA = await availability([{ product_id: productA, quantity: 1 }]);
    expect(afterA[productA]).toBe(0);
    expect(afterA[productB]).toBe(0);

    const afterB = await availability([{ product_id: productB, quantity: 1 }]);
    expect(afterB[productA]).toBe(0);
    expect(afterB[productB]).toBe(0);
  });

  it('releases virtual capacity when the cart line is removed and never borrows another warehouse', async () => {
    expect((await availability([]))[productA]).toBe(1);
    const emptyWarehouse = await availability([], otherWarehouseId);
    expect(emptyWarehouse[productA]).toBe(0);
    expect(emptyWarehouse[productB]).toBe(0);
  });

  it('is read-only and remains on the canonical composition contract', async () => {
    const before = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.inventory_ledger WHERE raw_material_id=$1`, [rawId]);
    await availability([{ product_id: productA, quantity: 1 }]);
    await availability([]);
    const after = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.inventory_ledger WHERE raw_material_id=$1`, [rawId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);

    const def = await client.query<{ body: string }>(
      `SELECT pg_get_functiondef('public.check_pos_cart_availability(uuid,uuid,jsonb)'::regprocedure) AS body`,
    );
    expect(def.rows[0].body).toContain('product_unit_links');
    expect(def.rows[0].body).toContain('warehouse_id = p_warehouse_id');
    expect(def.rows[0].body).not.toContain('product_components');
  });
});
