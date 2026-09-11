import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = { success?: boolean; error?: string; detail?: string; stock_count_id?: string; items_applied?: number };

describe.skipIf(skip)('raw-material stock count regression', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const userA = randomUUID();
  const role = `qa_stock_count_${randomUUID().slice(0, 8)}`;
  const rawA = randomUUID();
  const rawB = randomUUID();
  const productA = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function createCount(items: Record<string, unknown>[]): Promise<RpcResult> {
    return asUser(userA, async () => {
      const result = await client.query<{ result: RpcResult }>(
        `SELECT public.create_stock_count($1,$2,'cycle','qa', $3::jsonb) AS result`,
        [branchA, warehouseA, JSON.stringify(items)],
      );
      return result.rows[0].result;
    });
  }

  async function applyCount(stockCountId: string): Promise<RpcResult> {
    return asUser(userA, async () => {
      const result = await client.query<{ result: RpcResult }>(
        `SELECT public.apply_stock_count($1) AS result`,
        [stockCountId],
      );
      return result.rows[0].result;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'Count A'),($2,'Count B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'جرد اختبار','Stock count QA','["inventory.count.create","inventory.count.approve"]'::jsonb,'global',true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Stock Count QA',$3,$4,true)`,
      [userA, `${randomUUID()}@test.local`, role, branchA],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES ($1,'Count WH',$2,true)`,
      [warehouseA, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES
       ($1,$3,'Raw A',$5,4,true),($2,$4,'Raw B',$6,9,true)`,
      [rawA, rawB, `RAW-A-${randomUUID()}`, `RAW-B-${randomUUID()}`, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES ($1,$2,10,4)`,
      [rawA, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,$3,'COUNT-RAW-QA',10,4,'opening')`,
      [rawA, branchA, warehouseA],
    );
    await client.query(
      `INSERT INTO public.products(id,name,sku,barcode,sale_price,cost_price,branch_id,is_active)
       VALUES ($1,'Count Product','COUNT-P','COUNT-P',10,5,$2,true)`,
      [productA, branchA],
    );
    await client.query(
      `INSERT INTO public.inventory(product_id,warehouse_id,branch_id,quantity) VALUES ($1,$2,$3,5)`,
      [productA, warehouseA, branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_batches(product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,$3,'COUNT-PRODUCT-QA',5,5,'opening')`,
      [productA, warehouseA, branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('creates and applies a raw-material count once', async () => {
    const created = await createCount([{ raw_material_id: rawA, counted_quantity: 7, reason: 'physical count' }]);
    expect(created.success).toBe(true);
    expect(created.stock_count_id).toBeTruthy();

    const item = await client.query<{
      product_id: string | null;
      raw_material_id: string | null;
      system_quantity: string;
      counted_quantity: string;
    }>(
      `SELECT product_id,raw_material_id,system_quantity,counted_quantity
       FROM public.stock_count_items WHERE stock_count_id=$1`,
      [created.stock_count_id],
    );
    expect(item.rows[0]).toMatchObject({ product_id: null, raw_material_id: rawA });
    expect(Number(item.rows[0].system_quantity)).toBe(10);
    expect(Number(item.rows[0].counted_quantity)).toBe(7);

    await client.query(`UPDATE public.stock_counts SET status='approved' WHERE id=$1`, [created.stock_count_id]);
    const applied = await applyCount(created.stock_count_id!);
    expect(applied).toMatchObject({ success: true, items_applied: 1 });

    const balance = await client.query<{ quantity: string }>(
      `SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawA, branchA],
    );
    expect(Number(balance.rows[0].quantity)).toBe(7);

    const retry = await applyCount(created.stock_count_id!);
    expect(retry).toMatchObject({ success: false, error: 'COUNT_NOT_APPROVED' });
    const balanceAfterRetry = await client.query<{ quantity: string }>(
      `SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawA, branchA],
    );
    expect(Number(balanceAfterRetry.rows[0].quantity)).toBe(7);
  });

  it('keeps the existing product stock-count path working', async () => {
    const created = await createCount([{ product_id: productA, counted_quantity: 7, reason: 'product regression' }]);
    expect(created.success).toBe(true);
    await client.query(`UPDATE public.stock_counts SET status='approved' WHERE id=$1`, [created.stock_count_id]);
    expect(await applyCount(created.stock_count_id!)).toMatchObject({ success: true, items_applied: 1 });

    const stock = await client.query<{ quantity: string }>(
      `SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2`,
      [productA, warehouseA],
    );
    expect(Number(stock.rows[0].quantity)).toBe(7);
  });

  it('rejects a raw material that belongs to another branch', async () => {
    const result = await createCount([{ raw_material_id: rawB, counted_quantity: 1, reason: 'cross branch' }]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('TRANSACTION_FAILED');
    expect(result.detail).toContain('RAW_MATERIAL_NOT_IN_BRANCH');
  });
});
