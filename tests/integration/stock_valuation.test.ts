import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('stock valuation RPC (072/076)', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const whA = randomUUID();
  const whB = randomUUID();
  const prodA = randomUUID();
  const prodB = randomUUID();
  const adminId = randomUUID();
  const cashierId = randomUUID();

  async function asUser<T>(userId: string, role: 'authenticated' | 'anon' = 'authenticated', fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE ${role}`);
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  interface ValRow { product_id: string; product_name: string; warehouse_id: string; branch_id: string; quantity: string; unit_cost: string; total_value: string }
  interface SumRow { branch_id: string; branch_name: string; total_quantity: string; total_value: string; item_count: string }

  const valuation = (branchId: string | null, warehouseId: string | null) => client.query<ValRow>(
    `SELECT product_id, product_name, warehouse_id, branch_id,
            quantity::text AS quantity, unit_cost::text AS unit_cost, total_value::text AS total_value
     FROM public.get_stock_valuation($1, $2)`, [branchId, warehouseId]);

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    const orgId = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1,$2,$3)`, [orgId, 'SV Org', `sv-${randomUUID().slice(0, 8)}`]);
    await client.query(`INSERT INTO public.branches (id,name,organization_id) VALUES ($1,'Branch A',$3),($2,'Branch B',$3)`, [branchA, branchB, orgId]);
    await client.query(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'WH A',$2,true),($3,'WH B',$4,true)`, [whA, branchA, whB, branchB]);
    await client.query(`INSERT INTO public.products (id,name,branch_id,sale_price,cost_price,is_active) VALUES ($1,'Product A',$2,200,100,true),($3,'Product B',$4,100,50,true)`, [prodA, branchA, prodB, branchB]);
    await client.query(`INSERT INTO public.inventory_batches (product_id,warehouse_id,branch_id,quantity,unit_cost,source_type) VALUES ($1,$2,$3,10,100,'opening'),($1,$2,$3,10,50,'opening')`, [prodA, whA, branchA]);
    await client.query(`INSERT INTO public.inventory_batches (product_id,warehouse_id,branch_id,quantity,unit_cost,source_type) VALUES ($1,$2,$3,5,40,'opening')`, [prodB, whB, branchB]);

    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Super Admin','super_admin',$3,true),($4,$5,'Cashier A','cashier',$3,true)`,
      [adminId, `admin-${randomUUID()}@test.local`, branchA, cashierId, `cashier-${randomUUID()}@test.local`],
    );
    await client.query(`INSERT INTO public.organization_members (organization_id,user_id,membership_role,is_active) VALUES ($1,$2,'admin',true),($1,$3,'member',true)`, [orgId, adminId, cashierId]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('exposes the expected (uuid, uuid) SECURITY DEFINER signatures', async () => {
    const r = await client.query<{ proname: string; identity_args: string; prosecdef: boolean }>(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args, p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('get_stock_valuation','get_stock_valuation_summary') ORDER BY p.proname`);
    const byName = new Map(r.rows.map((row) => [row.proname, row]));
    expect(byName.get('get_stock_valuation')?.identity_args).toBe('p_branch_id uuid, p_warehouse_id uuid');
    expect(byName.get('get_stock_valuation_summary')?.identity_args).toBe('p_branch_id uuid, p_warehouse_id uuid');
    expect(byName.get('get_stock_valuation')?.prosecdef).toBe(true);
    expect(byName.get('get_stock_valuation_summary')?.prosecdef).toBe(true);
  });

  it('Super Admin scans all branches and computes weighted-average valuation', async () => {
    const rows = (await asUser(adminId, 'authenticated', () => valuation(null, null))).rows;
    const a = rows.find((r) => r.product_id === prodA);
    const b = rows.find((r) => r.product_id === prodB);
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect(a!.branch_id).toBe(branchA); expect(a!.quantity).toBe('20.0000');
    expect(Number(a!.unit_cost)).toBeCloseTo(75, 2); expect(Number(a!.total_value)).toBeCloseTo(1500, 2);
    expect(b!.branch_id).toBe(branchB); expect(b!.quantity).toBe('5.0000');
    expect(Number(b!.unit_cost)).toBeCloseTo(40, 2); expect(Number(b!.total_value)).toBeCloseTo(200, 2);
  });

  it('Super Admin p_branch_id filter limits results to that branch', async () => {
    const res = await asUser(adminId, 'authenticated', () => valuation(branchA, null));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].branch_id).toBe(branchA);
    expect(res.rows[0].product_id).toBe(prodA);
  });

  it('staff scope executes and remains branch-locked', async () => {
    const res = await asUser(cashierId, 'authenticated', () => valuation(null, null));
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.branch_id === branchA)).toBe(true);
    expect(res.rows.every((r) => r.branch_id !== branchB)).toBe(true);
  });

  it('summary returns per-branch totals consistent with valuation', async () => {
    const res = await asUser(adminId, 'authenticated', () => client.query<SumRow>(`
      SELECT branch_id,branch_name,total_quantity::text AS total_quantity,total_value::text AS total_value,item_count::text AS item_count
      FROM public.get_stock_valuation_summary(NULL,NULL)`));
    const a = res.rows.find((r) => r.branch_id === branchA);
    const b = res.rows.find((r) => r.branch_id === branchB);
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
    expect(a!.branch_name).toBe('Branch A'); expect(Number(a!.total_quantity)).toBeCloseTo(20, 4); expect(Number(a!.total_value)).toBeCloseTo(1500, 2); expect(Number(a!.item_count)).toBe(1);
    expect(b!.branch_name).toBe('Branch B'); expect(Number(b!.total_quantity)).toBeCloseTo(5, 4); expect(Number(b!.total_value)).toBeCloseTo(200, 2); expect(Number(b!.item_count)).toBe(1);
  });
});
