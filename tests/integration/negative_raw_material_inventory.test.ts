import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type CoreRpc = {
  success?: boolean;
  error?: string;
  shortage?: string | number;
  oversold?: string | number;
  raw_oversold?: Array<{ raw_material_id: string; quantity: string | number }>;
  [key: string]: unknown;
};

type BatchRow = { batch_number: string; quantity: string; source_type: string; warehouse_id: string | null };

const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('Negative raw-material inventory (sale oversell into debt batches)', () => {
  let client: pg.Client;

  // Branch A fixtures.
  const branchA = randomUUID();
  const branchB = randomUUID();
  const whA1 = randomUUID();
  const whA2 = randomUUID();
  const whB = randomUUID();
  const unitId = randomUUID();

  const rawX = randomUUID();
  const rawY = randomUUID();
  const rawZ = randomUUID();
  const rawW = randomUUID();
  const rawV = randomUUID();
  const rawD = randomUUID();
  const rawK = randomUUID();
  const rawL = randomUUID();
  const rawM = randomUUID();
  const rawX2 = randomUUID();
  const rawY2 = randomUUID();
  const rawU = randomUUID();
  const rawBX = randomUUID();

  const prodX = randomUUID();
  const prodY = randomUUID();
  const prodZ = randomUUID();
  const prodW = randomUUID();
  const prodV = randomUUID();
  const prodD = randomUUID();
  const prodK = randomUUID();
  const prodL = randomUUID();
  const prod2 = randomUUID();
  const prodBx = randomUUID();
  const readyProd = randomUUID();
  const prodMfg = randomUUID();
  const unitMfg = randomUUID();
  const prodInactive = randomUUID();
  const prodBadRecipe = randomUUID();
  const recipeBad = randomUUID();

  const recipeX = randomUUID();
  const recipeY = randomUUID();
  const recipeZ = randomUUID();
  const recipeW = randomUUID();
  const recipeV = randomUUID();
  const recipeD = randomUUID();
  const recipeK = randomUUID();
  const recipeL = randomUUID();
  const recipe2 = randomUUID();
  const recipeBx = randomUUID();

  const refSeq = (() => {
    let n = 0;
    return () => `${++n}`;
  })();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function addRaw(rawId: string, branchId: string, whId: string, qty: number, cost = 0): Promise<CoreRpc> {
    const refId = randomUUID();
    const r = await q<{ r: CoreRpc }>(
      `SELECT public._raw_add($1,$2,$3,$4,$5,NULL,NULL,NULL,'purchase_receipt','purchase_receipt',$6,$7,$8) AS r`,
      [rawId, branchId, whId, qty, cost, refId, `REF-${refSeq()}`, null],
    );
    return r[0].r;
  }

  async function saleCore(branchId: string, whId: string, productId: string, qty: number): Promise<CoreRpc> {
    const refId = randomUUID();
    const items = JSON.stringify([{ product_id: productId, quantity: qty }]);
    const r = await q<{ r: CoreRpc }>(
      `SELECT public._deduct_sale_inventory_with_modifiers_core($1,$2,$3::jsonb,$4,$5) AS r`,
      [branchId, whId, items, refId, `SALE-${refSeq()}`],
    );
    return r[0].r;
  }

  async function balance(rawId: string, branchId: string): Promise<number> {
    const r = await q<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text AS quantity FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawId, branchId],
    );
    return num(r[0].quantity);
  }

  async function inventoryBalance(rawId: string, branchId: string): Promise<number> {
    const r = await q<{ quantity: string }>(
      `SELECT quantity::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawId, branchId],
    );
    return r.length ? num(r[0].quantity) : 0;
  }

  async function warehouseBalance(rawId: string, branchId: string, whId: string): Promise<number> {
    const r = await q<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text AS quantity FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [rawId, branchId, whId],
    );
    return num(r[0].quantity);
  }

  async function oversoldBatches(rawId: string): Promise<BatchRow[]> {
    return q<BatchRow>(
      `SELECT batch_number, quantity::text AS quantity, source_type, warehouse_id
       FROM public.raw_material_batches WHERE raw_material_id=$1 AND source_type='sale_oversold'
       ORDER BY created_at, id`,
      [rawId],
    );
  }

  async function ledgerSum(rawId: string): Promise<number> {
    const r = await q<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text AS quantity FROM public.inventory_ledger WHERE raw_material_id=$1`,
      [rawId],
    );
    return num(r[0].quantity);
  }

  async function insertRaw(rawId: string, branchId: string, codeSuffix: string): Promise<void> {
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
       VALUES($1,$2,'Negative Raw',$3,$4,3,true)`,
      [rawId, `NRM-${codeSuffix}`, branchId, unitId],
    );
  }

  async function insertRecipeProduct(productId: string, recipeId: string, branchId: string, name: string, rawIds: string[]): Promise<void> {
    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active)
       VALUES($1,$2,$3,20,5,true)`,
      [productId, name, branchId],
    );
    await client.query(
      `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES($1,$2,$3,'Negative Recipe',1,true)`,
      [recipeId, productId, branchId],
    );
    for (const rawId of rawIds) {
      await client.query(
        `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
         VALUES($1,$2,1,0)`,
        [recipeId, rawId],
      );
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches(id,name) VALUES ($1,'Negative A'),($2,'Negative B')`, [branchA, branchB]);
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES
       ($1,'Neg A1',$4,true),($2,'Neg A2',$4,true),($3,'Neg B1',$5,true)`,
      [whA1, whA2, whB, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active)
       VALUES($1,$2,'Kilogram','kg',true)`,
      [unitId, `KG-${randomUUID().slice(0, 8)}`],
    );

    const branchARaws: Array<[string, string]> = [
      [rawX, 'X'], [rawY, 'Y'], [rawZ, 'Z'], [rawW, 'W'], [rawV, 'V'],
      [rawD, 'D'], [rawK, 'K'], [rawL, 'L'], [rawM, 'M'], [rawX2, 'X2'], [rawY2, 'Y2'], [rawU, 'U'],
    ];
    for (const [rawId, code] of branchARaws) await insertRaw(rawId, branchA, code);
    await insertRaw(rawBX, branchB, 'BX');

    await insertRecipeProduct(prodX, recipeX, branchA, 'Neg Product X', [rawX]);
    await insertRecipeProduct(prodY, recipeY, branchA, 'Neg Product Y', [rawY]);
    await insertRecipeProduct(prodZ, recipeZ, branchA, 'Neg Product Z', [rawZ]);
    await insertRecipeProduct(prodW, recipeW, branchA, 'Neg Product W', [rawW]);
    await insertRecipeProduct(prodV, recipeV, branchA, 'Neg Product V', [rawV]);
    await insertRecipeProduct(prodD, recipeD, branchA, 'Neg Product D', [rawD]);
    await insertRecipeProduct(prodK, recipeK, branchA, 'Neg Product K', [rawK]);
    await insertRecipeProduct(prodL, recipeL, branchA, 'Neg Product L', [rawL]);
    await insertRecipeProduct(prod2, recipe2, branchA, 'Neg Product 2', [rawX2, rawY2]);
    await insertRecipeProduct(prodBx, recipeBx, branchB, 'Neg Product BX', [rawBX]);

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,product_type,sale_price,cost_price,is_active)
       VALUES($1,'Neg Ready Product',$2,'ready',30,10,true)`,
      [readyProd, branchA],
    );

    await client.query(
      `INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,is_active)
       VALUES($1,$2,'Mfg Unit A','manufactured',$3,true)`,
      [unitMfg, `MU-${randomUUID().slice(0, 8)}`, branchA],
    );
    await client.query(
      `INSERT INTO public.products(id,name,branch_id,product_type,sale_price,cost_price,is_active)
       VALUES($1,'Neg Mfg Product',$2,'manufactured',25,6,true)`,
      [prodMfg, branchA],
    );
    await client.query(
      `INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)`,
      [prodMfg, unitMfg],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$2,1,0)`,
      [unitMfg, rawU],
    );

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active)
       VALUES($1,'Neg Inactive Product',$2,40,5,false)`,
      [prodInactive, branchA],
    );

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active)
       VALUES($1,'Neg Bad Recipe Product',$2,20,5,true)`,
      [prodBadRecipe, branchA],
    );
    await client.query(
      `INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active)
       VALUES($1,$2,$3,'Bad Cross-Branch Recipe',1,true)`,
      [recipeBad, prodBadRecipe, branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('oversells without GUI permission gate by allowing the raw shortage', async () => {
    await addRaw(rawX, branchA, whA1, 3, 4);
    const r = await saleCore(branchA, whA1, prodX, 7);
    expect(r.success).toBe(true);
    const oversold = (r.raw_oversold || [])[0];
    expect(num(oversold?.quantity)).toBe(4);

    expect(await balance(rawX, branchA)).toBe(-4);
    expect(await inventoryBalance(rawX, branchA)).toBe(-4);
    const debts = await oversoldBatches(rawX);
    expect(debts).toHaveLength(1);
    expect(num(debts[0].quantity)).toBe(-4);
    expect(debts[0].source_type).toBe('sale_oversold');
    expect(debts[0].warehouse_id).toBe(whA1);
  });

  it('credits availability with raw_shortage_only only for raw-only recipe products', async () => {
    const rows = await q<{ product_id: string; available_quantity: string; is_available: boolean; raw_shortage_only: boolean }>(
      `SELECT product_id, available_quantity::text, is_available, raw_shortage_only
       FROM public.get_pos_product_availability($1,$2,100)
       WHERE product_id IN ($3,$4) ORDER BY product_id`,
      [branchA, whA1, prodX, readyProd],
    );
    const byId = new Map(rows.map((r) => [r.product_id, r]));
    const recipeRow = byId.get(prodX);
    const readyRow = byId.get(readyProd);
    expect(recipeRow).toBeTruthy();
    expect(recipeRow!.is_available).toBe(false);
    expect(num(recipeRow!.available_quantity)).toBe(0);
    expect(recipeRow!.raw_shortage_only).toBe(true);

    expect(readyRow).toBeTruthy();
    expect(readyRow!.is_available).toBe(false);
    expect(num(readyRow!.available_quantity)).toBe(0);
    expect(readyRow!.raw_shortage_only).toBe(false);
  });

  it('keeps the oversold debt warehouse-scoped and lets another warehouse net separately', async () => {
    await addRaw(rawY, branchA, whA1, 5, 4);
    const r = await saleCore(branchA, whA1, prodY, 8);
    expect(r.success).toBe(true);
    expect(num((r.raw_oversold || [])[0]?.quantity)).toBe(3);
    expect(await warehouseBalance(rawY, branchA, whA1)).toBe(-3);
    expect(await warehouseBalance(rawY, branchA, whA2)).toBe(0);

    await addRaw(rawY, branchA, whA2, 2, 4);
    expect(await warehouseBalance(rawY, branchA, whA1)).toBe(-3);
    expect(await warehouseBalance(rawY, branchA, whA2)).toBe(2);
    expect(await balance(rawY, branchA)).toBe(-1);
    expect(await inventoryBalance(rawY, branchA)).toBe(-1);
    const debts = await oversoldBatches(rawY);
    expect(debts).toHaveLength(1);
    expect(debts[0].warehouse_id).toBe(whA1);
  });

  it('sells from zero stock into a negative balance', async () => {
    const r = await saleCore(branchA, whA1, prodZ, 4);
    expect(r.success).toBe(true);
    expect(num((r.raw_oversold || [])[0]?.quantity)).toBe(4);
    expect(await balance(rawZ, branchA)).toBe(-4);
  });

  it('deepens an already-negative balance in a single debt batch', async () => {
    const r = await saleCore(branchA, whA1, prodZ, 3);
    expect(r.success).toBe(true);
    expect(num((r.raw_oversold || [])[0]?.quantity)).toBe(3);
    expect(await balance(rawZ, branchA)).toBe(-7);
    expect(await inventoryBalance(rawZ, branchA)).toBe(-7);
    const debts = await oversoldBatches(rawZ);
    expect(debts).toHaveLength(2);
    // created_at is transaction-stable in PostgreSQL, so UUID ordering cannot
    // prove insertion order. Assert the complete debt set without weakening it.
    expect(debts.map((row) => num(row.quantity)).sort((a, b) => a - b)).toEqual([-4, -3]);
  });

  it('offsets a negative balance back to positive with plain SUM netting (no clamp)', async () => {
    await saleCore(branchA, whA1, prodW, 7);
    expect(await balance(rawW, branchA)).toBe(-7);
    await addRaw(rawW, branchA, whA1, 10, 3);
    expect(await balance(rawW, branchA)).toBe(3);
    expect(await inventoryBalance(rawW, branchA)).toBe(3);
  });

  it('partially offsets a negative balance and stays negative', async () => {
    await saleCore(branchA, whA1, prodV, 7);
    expect(await balance(rawV, branchA)).toBe(-7);
    await addRaw(rawV, branchA, whA1, 5, 3);
    expect(await balance(rawV, branchA)).toBe(-2);
    expect(await inventoryBalance(rawV, branchA)).toBe(-2);
  });

  it('deducts multiple raw materials of one recipe independently into separate debts', async () => {
    const r = await saleCore(branchA, whA1, prod2, 4);
    expect(r.success).toBe(true);
    expect(r.raw_oversold).toHaveLength(2);
    expect(await balance(rawX2, branchA)).toBe(-4);
    expect(await balance(rawY2, branchA)).toBe(-4);
    expect((await oversoldBatches(rawX2))).toHaveLength(1);
    expect((await oversoldBatches(rawY2))).toHaveLength(1);
  });

  it('isolates the negative debt per branch and never leaks across branches', async () => {
    await addRaw(rawBX, branchB, whB, 6, 4);
    const r = await saleCore(branchB, whB, prodBx, 9);
    expect(r.success).toBe(true);
    expect(num((r.raw_oversold || [])[0]?.quantity)).toBe(3);
    expect(await balance(rawBX, branchB)).toBe(-3);
    expect(await balance(rawX, branchA)).toBe(-4);
    expect((await oversoldBatches(rawBX))[0].warehouse_id).toBe(whB);
  });

  it('posts each sale shortage exactly once into the ledger and batches', async () => {
    await addRaw(rawD, branchA, whA1, 4, 4);
    const first = await saleCore(branchA, whA1, prodD, 2);
    expect(first.success).toBe(true);
    expect(first.raw_oversold).toEqual([]);
    expect(await balance(rawD, branchA)).toBe(2);

    const second = await saleCore(branchA, whA1, prodD, 3);
    expect(second.success).toBe(true);
    expect(num((second.raw_oversold || [])[0]?.quantity)).toBe(1);
    expect(await balance(rawD, branchA)).toBe(-1);
    const debts = await oversoldBatches(rawD);
    expect(debts).toHaveLength(1);
    expect(num(debts[0].quantity)).toBe(-1);

    const ledger = await q<{ quantity: string; batch_number: string }>(
      `SELECT quantity::text AS quantity, batch_number FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND entry_type='sale' AND reference_type='sale'
       ORDER BY id`,
      [rawD],
    );
    const saleDeltas = ledger.map((r) => num(r.quantity));
    expect(saleDeltas).toEqual([-2, -2, -1]);
    expect(ledger.filter((r) => r.batch_number.startsWith('OV-'))).toHaveLength(1);
  });

  it('restores a kitchen void exactly once and never double-restores on repeat', async () => {
    await saleCore(branchA, whA1, prodK, 4);
    expect(await balance(rawK, branchA)).toBe(-4);

    const orderId = randomUUID();
    const orderItemId = randomUUID();
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO public.orders(id,order_number,branch_id,status,kitchen_status,station)
       VALUES($1,'NEG-KVOID',$2,'open','sent','main')`,
      [orderId, branchA],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,voided_quantity,total_cost)
       VALUES($1,$2,$3,$4,$5,2,0,0)`,
      [eventId, branchA, whA1, orderId, orderItemId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost)
       VALUES($1,$2,$3,'raw_material',$4,2,0)`,
      [eventId, branchA, whA1, rawK],
    );

    const first = await q<{ r: CoreRpc }>(
      `SELECT public._restore_kitchen_inventory_for_void($1,$2,2) AS r`,
      [orderId, orderItemId],
    );
    expect(first[0].r.success).toBe(true);
    expect(first[0].r.inventory_changed).toBe(true);
    expect(num(first[0].r.restored_sent_quantity)).toBe(2);
    expect(await balance(rawK, branchA)).toBe(-2);

    const reVoid = await q<{ r: CoreRpc }>(
      `SELECT public._restore_kitchen_inventory_for_void($1,$2,2) AS r`,
      [orderId, orderItemId],
    );
    expect(reVoid[0].r.success).toBe(true);
    expect(reVoid[0].r.inventory_changed).toBe(false);
    expect(num(reVoid[0].r.restored_sent_quantity)).toBe(0);
    expect(await balance(rawK, branchA)).toBe(-2);
    const kv = await q<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.raw_material_batches WHERE raw_material_id=$1 AND batch_number LIKE 'KV-%'`,
      [rawK],
    );
    expect(num(kv[0].c)).toBe(1);
  });

  it('keeps inventory, batches and ledger mutually consistent after a negative cycle', async () => {
    await addRaw(rawL, branchA, whA1, 5, 3);
    expect(await inventoryBalance(rawL, branchA)).toBe(5);
    await saleCore(branchA, whA1, prodL, 9);
    expect(await inventoryBalance(rawL, branchA)).toBe(-4);
    const avgNeg = await q<{ avg_cost: string }>(
      `SELECT avg_cost::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawL, branchA],
    );
    expect(num(avgNeg[0].avg_cost)).toBe(0);
    await addRaw(rawL, branchA, whA1, 6, 3);

    expect(await balance(rawL, branchA)).toBe(2);
    expect(await inventoryBalance(rawL, branchA)).toBe(2);
    expect(await ledgerSum(rawL)).toBe(2);
    const avgPos = await q<{ avg_cost: string }>(
      `SELECT avg_cost::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawL, branchA],
    );
    expect(num(avgPos[0].avg_cost)).toBe(9);
  });

  it('keeps strict callers (default allow_negative=false) from going negative', async () => {
    await addRaw(rawM, branchA, whA1, 2, 4);
    const r = await q<{ r: CoreRpc }>(
      `SELECT public._raw_remove_fifo($1,$2,$3,5,'production','production',NULL,NULL,NULL,false) AS r`,
      [rawM, branchA, whA1],
    );
    expect(r[0].r.success).toBe(true);
    expect(num(r[0].r.shortage)).toBe(3);
    expect(num(r[0].r.oversold)).toBe(0);
    expect(await balance(rawM, branchA)).toBe(0);
    expect(await oversoldBatches(rawM)).toEqual([]);
  });

  it('keeps manufactured-unit products strictly unavailable (never raw_shortage_only)', async () => {
    const rows = await q<{ product_id: string; available_quantity: string; is_available: boolean; raw_shortage_only: boolean }>(
      `SELECT product_id, available_quantity::text, is_available, raw_shortage_only
       FROM public.get_pos_product_availability($1,$2,100)
       WHERE product_id = $3`,
      [branchA, whA1, prodMfg],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_available).toBe(false);
    expect(num(rows[0].available_quantity)).toBe(0);
    expect(rows[0].raw_shortage_only).toBe(false);

    const sale = await q<{ r: CoreRpc }>(
      `SELECT public._deduct_sale_inventory_with_modifiers_core($1,$2,$3::jsonb,$4,$5) AS r`,
      [branchA, whA1, JSON.stringify([{ product_id: prodMfg, quantity: 1 }]), randomUUID(), 'SALE-MFG'],
    );
    expect(sale[0].r).toMatchObject({ success: false, error: 'SALE_INVENTORY_DEDUCTION_FAILED' });
    expect(await warehouseBalance(rawU, branchA, whA1)).toBe(0);
    expect(await oversoldBatches(rawU)).toEqual([]);
  });

  it('never exposes an inactive product through POS availability', async () => {
    const rows = await q<{ product_id: string }>(
      `SELECT product_id FROM public.get_pos_product_availability($1,$2,100) WHERE product_id = $3`,
      [branchA, whA1, prodInactive],
    );
    expect(rows).toHaveLength(0);
  });

  it('returns a cross-branch recipe as a blocked configuration row, never raw shortage', async () => {
    const guardState = await q<{
      replication_role: string;
      trigger_enabled: string;
      function_has_guard: boolean;
      recipe_branch: string;
      material_branch: string;
    }>(
      `SELECT current_setting('session_replication_role') AS replication_role,
              t.tgenabled::text AS trigger_enabled,
              position('RAW_MATERIAL_BRANCH_MISMATCH' in pg_get_functiondef(t.tgfoid)) > 0 AS function_has_guard,
              r.branch_id::text AS recipe_branch,
              rm.branch_id::text AS material_branch
       FROM pg_trigger t
       CROSS JOIN public.recipes r
       CROSS JOIN public.raw_materials rm
       WHERE t.tgrelid='public.recipe_items'::regclass
         AND t.tgname='trg_validate_recipe_item_branch'
         AND r.id=$1 AND rm.id=$2`,
      [recipeBad, rawBX],
    );
    expect(guardState).toEqual([{
      replication_role: 'origin',
      trigger_enabled: 'O',
      function_has_guard: true,
      recipe_branch: branchA,
      material_branch: branchB,
    }]);

    await client.query('SAVEPOINT invalid_recipe_write');
    await expect(
      client.query(
        `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
         VALUES($1,$2,1,0)`,
        [recipeBad, rawBX],
      ),
    ).rejects.toThrow(/RAW_MATERIAL_BRANCH_MISMATCH/);
    await client.query('ROLLBACK TO SAVEPOINT invalid_recipe_write');
    await client.query('RELEASE SAVEPOINT invalid_recipe_write');

    // Simulate a legacy corrupt row that predates the write-time guard. The
    // read contract must still return a precise blocked row, never omit it or
    // classify it as ordinary negative-raw sell-through.
    await client.query('ALTER TABLE public.recipe_items DISABLE TRIGGER trg_validate_recipe_item_branch');
    await client.query(
      `INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
       VALUES($1,$2,1,0)`,
      [recipeBad, rawBX],
    );
    await client.query('ALTER TABLE public.recipe_items ENABLE TRIGGER trg_validate_recipe_item_branch');

    const material = await q<{ branch_id: string }>(
      `SELECT branch_id FROM public.raw_materials WHERE id=$1`,
      [rawBX],
    );
    expect(material[0].branch_id).toBe(branchB);

    const chk = await q<{ r: CoreRpc }>(
      `SELECT public.check_product_availability($1,$2,$3,1) AS r`,
      [prodBadRecipe, branchA, whA1],
    );
    expect(chk[0].r).toMatchObject({ success: false, error: 'RAW_MATERIAL_NOT_IN_BRANCH' });

    const rows = await q<{ available_quantity: string; is_available: boolean; raw_shortage_only: boolean; availability_error: string | null }>(
      `SELECT available_quantity::text,is_available,raw_shortage_only,availability_error
       FROM public.get_pos_product_availability($1,$2,100) WHERE product_id=$3`,
      [branchA, whA1, prodBadRecipe],
    );
    expect(rows).toEqual([{
      available_quantity: '0',
      is_available: false,
      raw_shortage_only: false,
      availability_error: 'RAW_MATERIAL_NOT_IN_BRANCH',
    }]);

    const sale = await q<{ r: CoreRpc }>(
      `SELECT public._deduct_sale_inventory_with_modifiers_core($1,$2,$3::jsonb,$4,$5) AS r`,
      [branchA, whA1, JSON.stringify([{ product_id: prodBadRecipe, quantity: 1 }]), randomUUID(), 'SALE-BAD'],
    );
    expect(sale[0].r).toMatchObject({ success: false, error: 'RAW_MATERIAL_NOT_IN_BRANCH' });
  });
});
