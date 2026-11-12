import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl || !['localhost','127.0.0.1','[::1]'].includes(new URL(dbUrl).hostname);

type RpcResult = { success?: boolean; error?: string; detail?: string; stock_count_id?: string; items_applied?: number };

describe.skipIf(skip)('unwired material-locked stock count after kitchen oversell', () => {
  let client: pg.Client;
  let locker: pg.Client;
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
    await client.query("SELECT set_config('app.user_id',$1,true)",[userA]);
    return (await client.query("SELECT public._apply_stock_count_material_lock_candidate($1) result",[stockCountId])).rows[0].result;
  }

  beforeAll(async () => {
    if (skip) throw new Error('Disposable loopback database required');
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(readFileSync('scripts/experiments/kitchen_stock_count_material_lock_candidate_20261012.sql','utf8'));
    locker=openDb(dbUrl!); await locker.connect();

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'Count A'),($2,'Count B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'جرد اختبار','Stock count QA','["inventory.count.create","inventory.count.approve","inventory.count.reject","inventory.count.apply","pos.order.dine_in"]'::jsonb,'global',true)`,
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
    if (locker) { await locker.query('ROLLBACK').catch(()=>{}); await locker.end(); }
  });


  it('blocks behind the material lock, then counts the warehouse to its physical quantity once',async()=>{
    await client.query("SELECT public.ensure_chart_of_accounts($1)",[branchA]);
    await client.query("SELECT public.seed_account_mappings($1)",[branchA]);
    const secondWarehouse=randomUUID(),recipe=randomUUID(),order=randomUUID();
    await client.query("INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'Independent stock WH',$2,true)",[secondWarehouse,branchA]);
    await client.query(`INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type)
      VALUES($1,$2,$3,'COUNT-OTHER-WH',6,4,'opening')`,[rawA,branchA,secondWarehouse]);
    await client.query("INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active) VALUES($1,$2,$3,'Count lock recipe',1,true)",[recipe,productA,branchA]);
    await client.query("INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,1,0)",[recipe,rawA]);
    await client.query(`INSERT INTO public.orders(id,order_number,branch_id,status,inventory_warehouse_id,cashier_id)
      VALUES($1,$2,$3,'open',$4,$5)`,[order,'COUNT-LOCK-'+order,branchA,warehouseA,userA]);
    await client.query("INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,total) VALUES($1,$2,12,10,120)",[order,productA]);
    await client.query("SELECT set_config('app.user_id',$1,true)",[userA]);
    const balance=async(warehouse:string)=>Number((await client.query(`SELECT COALESCE(sum(quantity),0)::text q
      FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [rawA,branchA,warehouse])).rows[0].q);
    expect(await balance(warehouseA)).toBe(10);
    expect(await balance(secondWarehouse)).toBe(6);
    const created=await createCount([{raw_material_id:rawA,counted_quantity:5,unit_cost:4,reason:'physical count after negative'}]);
    expect(created.success,JSON.stringify(created)).toBe(true);
    const id=created.stock_count_id!;
    await client.query("UPDATE public.stock_counts SET status='approved' WHERE id=$1",[id]);
    await locker.query('BEGIN');
    try {
      const sameMaterial=(await locker.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0)) held",[rawA,branchA])).rows[0].held;
      expect(sameMaterial).toBe(true);
      const independent=(await locker.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0)) allowed",[rawB,branchB])).rows[0].allowed;
      expect(independent).toBe(true);
      await client.query("SET LOCAL lock_timeout='150ms'");
      const blocked=await applyCount(id);
      expect(blocked.success).toBe(false);
      expect(blocked.detail).toContain('lock timeout');
      expect(await balance(warehouseA)).toBe(10);
      expect((await client.query("SELECT status FROM public.stock_counts WHERE id=$1",[id])).rows[0].status).toBe('approved');
    } finally {
      await client.query("SET LOCAL lock_timeout='0'");
      await locker.query('ROLLBACK');
    }
    const sent=(await client.query("SELECT public._send_to_kitchen_core_20260914($1,$2) r",[order,userA])).rows[0].r;
    expect(sent.success,JSON.stringify(sent)).toBe(true);
    expect(await balance(warehouseA)).toBe(-2);
    const frozen=(await client.query("SELECT component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1",[order])).rows;
    const applied=await applyCount(id);
    expect(applied.success,JSON.stringify(applied)).toBe(true);
    expect(await balance(warehouseA)).toBe(5);
    expect(await balance(secondWarehouse)).toBe(6);
    expect(Number((await client.query("SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2",[rawA,branchA])).rows[0].quantity)).toBe(11);
    expect(await applyCount(id)).toMatchObject({success:false,error:'COUNT_NOT_APPROVED'});
    expect(await balance(warehouseA)).toBe(5);
    const journal=(await client.query("SELECT id FROM public.journal_entries WHERE reference_type='stock_count' AND reference_id=$1",[id])).rows;
    expect(journal).toHaveLength(1);
    const totals=(await client.query("SELECT sum(debit)::numeric debit,sum(credit)::numeric credit FROM public.journal_entry_lines WHERE journal_entry_id=$1",[journal[0].id])).rows[0];
    expect(Number(totals.debit)).toBe(Number(totals.credit));
    const sendSnapshot=(await client.query("SELECT component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1",[order])).rows;
    expect(sendSnapshot).toHaveLength(1);
    expect(sendSnapshot).toEqual(frozen);
    expect(sent.items_sent_count).toBe(1);
  });
  it('does not add a client entry point or a new privileged function',async()=>{
    expect((await client.query("SELECT has_function_privilege('authenticated','public._apply_stock_count_material_lock_candidate(uuid)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    const def=(await client.query("SELECT pg_get_functiondef('public._apply_stock_count_material_lock_candidate(uuid)'::regprocedure) source")).rows[0].source;
    expect(def).not.toContain('SECURITY DEFINER');
    expect(def.indexOf('pg_try_advisory_xact_lock')).toBeGreaterThan(0);
    expect(def.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(def.indexOf('FROM public.raw_material_warehouse_inventory'));
    expect(def).toContain('EXCEPTION WHEN lock_not_available');
    expect(def).toContain("current_setting('lock_timeout')");
  });
});
