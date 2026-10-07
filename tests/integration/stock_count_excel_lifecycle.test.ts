import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('raw-material stock count lifecycle', () => {
  let client: pg.Client;

  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const rawMaterialId = randomUUID();
  const adminId = randomUUID();
  let stockCountId = '';

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [adminId]);
    await client.query('SET LOCAL ROLE authenticated');
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function warehouseQty(): Promise<number> {
    const result = await client.query<{ quantity: string }>(
      `SELECT COALESCE(quantity, 0)::text AS quantity
       FROM public.raw_material_warehouse_inventory
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [rawMaterialId, branchId, warehouseId],
    );
    return Number(result.rows[0]?.quantity || 0);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.organizations(id,name,slug) VALUES ($1,'Count Org',$2)`,
      [orgId, `count-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches(id,name,organization_id) VALUES ($1,'Count Branch',$2)`,
      [branchId, orgId],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES ($1,'Count Warehouse',$2,true,true)`,
      [warehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
       VALUES ($1,$2,'Count Raw',$3,4,true)`,
      [rawMaterialId, `RAW-${randomUUID().slice(0, 8)}`, branchId],
    );
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Count Admin','super_admin',$3,true)`,
      [adminId, `count-${randomUUID()}@test.local`, branchId],
    );
    await client.query(
      `INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active)
       VALUES ($1,$2,'admin',true)`,
      [orgId, adminId],
    );

    await client.query(
      `INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost,min_stock)
       VALUES ($1,$2,10,4,0)`,
      [rawMaterialId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,$3,'COUNT-OPEN',10,4,'opening')`,
      [rawMaterialId, branchId, warehouseId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('creates a draft from counted quantities without changing warehouse stock', async () => {
    const before = await warehouseQty();
    expect(before).toBe(10);

    const created = await asAdmin(() => client.query<{ result: string }>(
      `SELECT public.create_stock_count($1,$2,'full',$3,$4::jsonb)::text AS result`,
      [
        branchId,
        warehouseId,
        'Excel month-opening count',
        JSON.stringify([{
          product_id: null,
          raw_material_id: rawMaterialId,
          counted_quantity: 7.5,
          reason: 'physical count',
        }]),
      ],
    ));
    const result = JSON.parse(created.rows[0].result) as { success: boolean; stock_count_id?: string };
    expect(result.success).toBe(true);
    expect(result.stock_count_id).toBeTruthy();
    stockCountId = result.stock_count_id!;

    expect(await warehouseQty()).toBe(10);

    const item = await client.query<{ system_quantity: string; counted_quantity: string }>(
      `SELECT system_quantity::text, counted_quantity::text
       FROM public.stock_count_items WHERE stock_count_id=$1 AND raw_material_id=$2`,
      [stockCountId, rawMaterialId],
    );
    expect(Number(item.rows[0].system_quantity)).toBe(10);
    expect(Number(item.rows[0].counted_quantity)).toBe(7.5);
  });

  it('submit and approve change workflow state but do not change stock', async () => {
    const submitted = await asAdmin(() => client.query<{ result: string }>(
      `SELECT public.submit_stock_count($1)::text AS result`, [stockCountId],
    ));
    expect(JSON.parse(submitted.rows[0].result).success).toBe(true);
    expect(await warehouseQty()).toBe(10);

    const approved = await asAdmin(() => client.query<{ result: string }>(
      `SELECT public.approve_stock_count($1)::text AS result`, [stockCountId],
    ));
    expect(JSON.parse(approved.rows[0].result).success).toBe(true);
    expect(await warehouseQty()).toBe(10);

    const state = await client.query<{ status: string }>(
      `SELECT status FROM public.stock_counts WHERE id=$1`, [stockCountId],
    );
    expect(state.rows[0].status).toBe('approved');
  });

  it('apply alone posts the variance through FIFO and becomes idempotently terminal', async () => {
    const applied = await asAdmin(() => client.query<{ result: string }>(
      `SELECT public.apply_stock_count($1)::text AS result`, [stockCountId],
    ));
    const result = JSON.parse(applied.rows[0].result) as { success: boolean; items_applied?: number };
    expect(result.success).toBe(true);
    expect(result.items_applied).toBe(1);
    expect(await warehouseQty()).toBe(7.5);

    const aggregate = await client.query<{ quantity: string }>(
      `SELECT quantity::text FROM public.raw_material_inventory
       WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawMaterialId, branchId],
    );
    expect(Number(aggregate.rows[0].quantity)).toBe(7.5);

    const second = await asAdmin(() => client.query<{ result: string }>(
      `SELECT public.apply_stock_count($1)::text AS result`, [stockCountId],
    ));
    const secondResult = JSON.parse(second.rows[0].result) as { success: boolean; error?: string; status?: string };
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toBe('COUNT_NOT_APPROVED');
    expect(secondResult.status).toBe('applied');
    expect(await warehouseQty()).toBe(7.5);
  });
  it('stores explicit Excel unit cost and exposes it only after the normal approval/apply lifecycle', async () => {
    const before = await warehouseQty();
    const make = async (unit_cost: unknown) => asAdmin(() => client.query<{ result: string }>(
      `SELECT public.create_stock_count($1,$2,'cycle','priced Excel',$3::jsonb)::text AS result`,
      [branchId, warehouseId, JSON.stringify([{ raw_material_id: rawMaterialId, counted_quantity: before, unit_cost }])],
    ));
    for (const bad of [-1, 0, 'NaN', 100000000]) {
      const result = await make(bad);
      expect(JSON.parse(result.rows[0].result).success).toBe(false);
      expect(await warehouseQty()).toBe(before);
    }
    const result = JSON.parse((await make(22.75)).rows[0].result);
    expect(result.success).toBe(true);
    const id = result.stock_count_id;
    const item = await client.query<{ unit_cost: string }>('SELECT unit_cost::text FROM public.stock_count_items WHERE stock_count_id=$1', [id]);
    expect(Number(item.rows[0].unit_cost)).toBe(22.75);
    expect(await warehouseQty()).toBe(before);
    const draftEvents = await asAdmin(() => client.query('SELECT * FROM public.get_raw_material_cost_history($1,$2,100) WHERE reference_number=$3', [rawMaterialId, branchId, result.count_number]));
    expect(draftEvents.rows).toHaveLength(0);
    for (const action of ['submit_stock_count', 'approve_stock_count', 'apply_stock_count']) {
      const applied = await asAdmin(() => client.query<{ result: string }>(`SELECT public.${action}($1)::text AS result`, [id]));
      expect(JSON.parse(applied.rows[0].result).success).toBe(true);
    }
    const events = await asAdmin(() => client.query<{ unit_cost: string }>('SELECT unit_cost::text FROM public.get_raw_material_cost_history($1,$2,100) WHERE reference_number=$3', [rawMaterialId, branchId, result.count_number]));
    expect(Number(events.rows[0].unit_cost)).toBe(22.75);
    expect(await warehouseQty()).toBe(before);
    const oldBatch = await client.query<{ unit_cost: string }>("SELECT unit_cost::text FROM public.raw_material_batches WHERE raw_material_id=$1 AND batch_number='COUNT-OPEN'", [rawMaterialId]);
    expect(Number(oldBatch.rows[0].unit_cost)).toBe(4);
    const currentCost = await client.query<{ cost: string }>("SELECT public._raw_cost_context_for_costing($1,$2)->>'unit_cost' AS cost", [rawMaterialId, branchId]);
    expect(Number(currentCost.rows[0].cost)).toBe(22.75); // current estimate follows applied count; old FIFO layer remains 4
    await client.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES ($1,$2,$3,'FIFO-NEW',5,10,'opening',clock_timestamp())", [rawMaterialId, branchId, warehouseId]);
    await client.query('UPDATE public.raw_material_inventory SET avg_cost=avg_cost WHERE raw_material_id=$1 AND branch_id=$2', [rawMaterialId, branchId]);
    const beforeIssue = await client.query<{ cost: string }>("SELECT public._raw_cost_context_for_costing($1,$2)->>'unit_cost' AS cost", [rawMaterialId, branchId]);
    expect(Number(beforeIssue.rows[0].cost)).toBe(22.75); // latest approved price is separate from actual stock valuation
    const inventoryBefore = await client.query<{ avg_cost: string }>('SELECT avg_cost FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2', [rawMaterialId, branchId]);
    expect(Number(inventoryBefore.rows[0].avg_cost)).toBe(6.4); // 7.5@4 + 5@10
    const issued = await client.query<{ result: { success: boolean; total_cost: number } }>("SELECT public._raw_remove_fifo($1,$2,$3,3,'production',NULL,NULL,NULL,$4,false) AS result", [rawMaterialId, branchId, warehouseId, adminId]);
    expect(issued.rows[0].result.success).toBe(true);
    expect(Number(issued.rows[0].result.total_cost)).toBe(12); // original FIFO layer remains 4 per unit
    const afterIssue = await client.query<{ cost: string }>("SELECT public._raw_cost_context_for_costing($1,$2)->>'unit_cost' AS cost", [rawMaterialId, branchId]);
    expect(Number(afterIssue.rows[0].cost)).toBe(22.75); // current estimate stays on the approved count price
    const inventoryAfter = await client.query<{ avg_cost: string }>('SELECT avg_cost FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2', [rawMaterialId, branchId]);
    expect(Number(inventoryAfter.rows[0].avg_cost)).toBe(7.16); // actual FIFO inventory valuation still refreshes

  });

});
