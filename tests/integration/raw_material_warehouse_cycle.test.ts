import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type Rpc = { success?: boolean; error?: string; transfer_id?: string; purchase_id?: string; [key: string]: unknown };

describe.skipIf(skip)('Stage B raw material warehouse cycle', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const whA1 = randomUUID();
  const whA2 = randomUUID();
  const whB = randomUUID();
  const userA = randomUUID();
  const role = `qa_raw_wh_${randomUUID().slice(0, 8)}`;
  const unitId = randomUUID();
  const rawId = randomUUID();
  const supplierId = randomUUID();
  const productId = randomUUID();
  const recipeId = randomUUID();

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userA]);
    await client.query('SET LOCAL ROLE authenticated');
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function rpc(sql: string, params: unknown[]): Promise<Rpc> {
    return asUser(async () => {
      const r = await client.query<{ r: Rpc }>(sql, params);
      return r.rows[0].r;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches(id,name) VALUES ($1,'Raw WH A'),($2,'Raw WH B')`, [branchA, branchB]);
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES
       ($1,'Raw A1',$4,true),($2,'Raw A2',$4,true),($3,'Raw B1',$5,true)`,
      [whA1, whA2, whB, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'مخزون خام QA','Raw warehouse QA',
       '["purchases.manage","inventory.transfer.create","inventory.transfer.approve"]'::jsonb,'global',true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES($1,$2,'Raw Warehouse User',$3,$4,true)`,
      [userA, `${randomUUID()}@test.local`, role, branchA],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active)
       VALUES($1,$2,'Kilogram','kg',true)`,
      [unitId, `KG-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
       VALUES($1,$2,'Stage B Raw',$3,$4,4,true)`,
      [rawId, `RAW-${randomUUID().slice(0, 8)}`, branchA, unitId],
    );
    await client.query(
      `INSERT INTO public.suppliers(id,name,branch_id,balance) VALUES($1,'Stage B Supplier',$2,0)`,
      [supplierId, branchA],
    );
    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active)
       VALUES($1,'Stage B Recipe Product',$2,20,5,true)`,
      [productId, branchA],
    );
    await client.query(
      `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES($1,$2,$3,'Stage B Recipe',1,true)`,
      [recipeId, productId, branchA],
    );
    await client.query(
      `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$2,1,0)`,
      [recipeId, rawId],
    );
    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchA]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchA]);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('receives raw stock only into the selected warehouse and writes warehouse ledger', async () => {
    const created = await rpc(
      `SELECT public.create_purchase_order($1,$2,$3,'cash',NULL,$4::jsonb,NULL) AS r`,
      [branchA, supplierId, whA1, JSON.stringify([{ raw_material_id: rawId, quantity: 5, unit_cost: 4, unit_name: 'kg' }])],
    );
    expect(created.success).toBe(true);
    const purchaseId = created.purchase_id as string;

    expect((await rpc(`SELECT public.update_purchase_order_status($1,'submitted') AS r`, [purchaseId])).success).toBe(true);
    expect((await rpc(`SELECT public.update_purchase_order_status($1,'approved') AS r`, [purchaseId])).success).toBe(true);

    const item = await client.query<{ id: string }>(`SELECT id FROM public.purchase_items WHERE purchase_id=$1`, [purchaseId]);
    const received = await rpc(
      `SELECT public.receive_purchase_order($1,$2::jsonb) AS r`,
      [purchaseId, JSON.stringify([{ purchase_item_id: item.rows[0].id, quantity_received: 5 }])],
    );
    expect(received.success).toBe(true);

    const stock = await client.query<{ warehouse_id: string; quantity: string }>(
      `SELECT warehouse_id,quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 ORDER BY warehouse_id`,
      [rawId],
    );
    expect(Object.fromEntries(stock.rows.map((r) => [r.warehouse_id, Number(r.quantity)]))).toEqual({ [whA1]: 5 });

    const ledger = await client.query<{ warehouse_id: string; quantity: string }>(
      `SELECT warehouse_id,quantity FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND reference_type='purchase_receipt' ORDER BY id`,
      [rawId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ warehouse_id: whA1 });
    expect(Number(ledger.rows[0].quantity)).toBe(5);
  });

  it('availability is warehouse-specific and still uses the canonical composition contract', async () => {
    const a1 = await client.query<{ r: Rpc }>(`SELECT public.check_product_availability($1,$2,$3,1) AS r`, [productId, branchA, whA1]);
    const a2 = await client.query<{ r: Rpc }>(`SELECT public.check_product_availability($1,$2,$3,1) AS r`, [productId, branchA, whA2]);
    expect(a1.rows[0].r.success).toBe(true);
    expect(a2.rows[0].r).toMatchObject({ success: false, error: 'INSUFFICIENT_RAW_MATERIAL_STOCK' });

    const def = await client.query<{ body: string }>(
      `SELECT pg_get_functiondef('public.check_product_availability(uuid,uuid,uuid,numeric)'::regprocedure) AS body`,
    );
    expect(def.rows[0].body).toContain('product_unit_links');
    expect(def.rows[0].body).toContain('raw_material_warehouse_inventory');
  });

  it('moves raw stock once between warehouses and re-approval cannot duplicate stock or ledger', async () => {
    const created = await rpc(
      `SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) AS r`,
      [whA1, whA2, branchA, JSON.stringify([{ item_type: 'raw_material', item_id: rawId, destination_item_id: rawId, quantity: 2, unit_cost: 4 }])],
    );
    expect(created.success).toBe(true);
    const transferId = created.transfer_id as string;
    expect((await rpc(`SELECT public.approve_warehouse_transfer($1) AS r`, [transferId])).success).toBe(true);
    expect(await rpc(`SELECT public.approve_warehouse_transfer($1) AS r`, [transferId])).toMatchObject({ success: false, error: 'INVALID_STATUS' });

    const stock = await client.query<{ warehouse_id: string; quantity: string }>(
      `SELECT warehouse_id,quantity FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 ORDER BY warehouse_id`,
      [rawId],
    );
    expect(Object.fromEntries(stock.rows.map((r) => [r.warehouse_id, Number(r.quantity)]))).toEqual({ [whA1]: 3, [whA2]: 2 });

    const ledger = await client.query<{ warehouse_id: string; quantity: string }>(
      `SELECT warehouse_id,quantity FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND reference_type='warehouse_transfer' AND reference_id=$2 ORDER BY id`,
      [rawId, transferId],
    );
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows.map((r) => [r.warehouse_id, Number(r.quantity)])).toEqual([[whA1, -2], [whA2, 2]]);
  });

  it('does not allow a single-branch user to forge a cross-branch transfer', async () => {
    const denied = await rpc(
      `SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) AS r`,
      [whA1, whB, branchA, JSON.stringify([{ item_type: 'raw_material', item_id: rawId, destination_item_id: rawId, quantity: 1, unit_cost: 4 }])],
    );
    expect(denied).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });
});
