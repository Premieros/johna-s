import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('ready-product sale deduction with legacy recipe', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const userId = randomUUID();
  const rawId = randomUUID();
  const productId = randomUUID();
  const recipeId = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE service_role`);
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'Ready Product Branch')`, [branchId]);
    await client.query(
      `INSERT INTO auth.users (id,email,role,aud,instance_id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       VALUES ($1,$2,'authenticated','authenticated',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,now(),now())`,
      [userId, `ready-product-${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Ready Product Super Admin','super_admin',$3,true)`,
      [userId, `ready-product-${userId}@example.test`, branchId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id,name,branch_id,is_active)
       VALUES ($1,'Ready Product WH',$2,true)`,
      [warehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_materials (id,code,name,min_stock,default_cost,is_active,branch_id)
       VALUES ($1,$2,'Legacy Orange Raw',0,1,true,$3)`,
      [rawId, `RAW-${randomUUID()}`, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_inventory (raw_material_id,branch_id,quantity,avg_cost)
       VALUES ($1,$2,0,1)`,
      [rawId, branchId],
    );
    await client.query(
      `INSERT INTO public.products (id,name,branch_id,product_type,sale_price,cost_price,is_active)
       VALUES ($1,'Ready Tango',$2,'ready',20,5,true)`,
      [productId, branchId],
    );
    await client.query(
      `INSERT INTO public.recipes (id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES ($1,$2,$3,'Legacy Tango Recipe',1,true)`,
      [recipeId, productId, branchId],
    );
    await client.query(
      `INSERT INTO public.recipe_items (recipe_id,raw_material_id,quantity,wastage_percent)
       VALUES ($1,$2,200,0)`,
      [recipeId, rawId],
    );
    await client.query(
      `INSERT INTO public.inventory_batches (product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,$3,$4,5,5,'opening')`,
      [productId, warehouseId, branchId, `READY-${randomUUID()}`],
    );

    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled=false`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('sells from finished stock without demanding legacy raw-material stock', async () => {
    await asAdmin(async () => {
      const availability = await q<{ r: { success: boolean; mode?: string; available?: number } }>(
        `SELECT public.check_product_availability($1,$2,$3,1) AS r`,
        [productId, branchId, warehouseId],
      );
      expect(availability[0].r.success).toBe(true);
      expect(availability[0].r.mode).toBe('ready_product');

      const sale = await q<{ r: { success: boolean; sale_id?: string; error?: string; detail?: string } }>(
        `SELECT public.process_sale($1,$2,$3,NULL,NULL,20,0,'amount',0,0,20,20,'cash','completed',$4::jsonb,NULL,'takeaway',NULL,NULL,NULL) AS r`,
        [
          `READY-${Date.now()}-${randomUUID()}`,
          branchId,
          warehouseId,
          JSON.stringify([{ product_id: productId, unit_name: 'piece', quantity: 1, unit_price: 20, discount_amount: 0, bonus_quantity: 0, total: 20 }]),
        ],
      );

      expect(sale[0].r.success).toBe(true);
      if (!sale[0].r.success || !sale[0].r.sale_id) throw new Error(JSON.stringify(sale[0].r));

      const finished = await q<{ quantity: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS quantity
         FROM public.inventory_batches
         WHERE product_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
        [productId, branchId, warehouseId],
      );
      expect(Number(finished[0].quantity)).toBe(4);

      const raw = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.raw_material_inventory
         WHERE raw_material_id=$1 AND branch_id=$2`,
        [rawId, branchId],
      );
      expect(Number(raw[0].quantity)).toBe(0);

      const effects = await q<{ target_type: string; quantity: string }>(
        `SELECT target_type, quantity::text
         FROM public.sale_item_inventory_effects
         WHERE sale_id=$1
         ORDER BY target_type`,
        [sale[0].r.sale_id],
      );
      expect(effects).toHaveLength(1);
      expect(effects[0].target_type).toBe('product');
      expect(Number(effects[0].quantity)).toBe(1);
    });
  });
});
