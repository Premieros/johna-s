import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// This suite must run against disposable CI/staging DB only. It creates the
// experimental function and fixtures inside BEGIN/ROLLBACK. It never enables
// the disabled production price-capture trigger or changes real orders.
const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('bounded approved ingredient prices (experimental, #486)', () => {
  let client: pg.Client;
  const org = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const material = randomUUID();
  const noApprovedPrice = randomUUID();
  const foreignMaterial = randomUUID();
  const purchasedMaterial = randomUUID();
  const manager = randomUUID();
  const purchase = randomUUID();
  const asOf = new Date();
  const t0 = new Date(asOf.getTime() - 3 * 60 * 60_000);
  const t1 = new Date(asOf.getTime() - 2 * 60 * 60_000);
  const t2 = new Date(asOf.getTime() - 60 * 60_000);
  const future = new Date(asOf.getTime() + 60 * 60_000);
  const afterFuture = new Date(asOf.getTime() + 2 * 60 * 60_000);

  async function prices(branch: string, ids: string[], time: Date) {
    const r = await client.query(
      `SELECT raw_material_id::text, branch_id::text, unit_cost::numeric(18,6)::text,
              price_source, priced_at::text, reference_number
       FROM public._kitchen_approved_price_candidate($1,$2::uuid[],$3)
       ORDER BY raw_material_id`,
      [branch, ids, time.toISOString()],
    );
    return r.rows as Array<{
      raw_material_id: string;
      branch_id: string;
      unit_cost: string;
      price_source: string;
      priced_at: string;
      reference_number: string | null;
    }>;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    // Function DDL is rolled back along with all fixtures.
    await client.query(readFileSync(
      'scripts/experiments/kitchen_approved_price_bounded_candidate_20261011.sql', 'utf8',
    ));
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.organizations(id,name,slug)
       VALUES ($1,'Kitchen Candidate Org',$2)`,
      [org, `kitchen-price-${randomUUID().slice(0,10)}`],
    );
    await client.query(
      `INSERT INTO public.branches(id,name,organization_id) VALUES
       ($1,'Candidate Branch A',$3),($2,'Candidate Branch B',$3)`,
      [branchA, branchB, org],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active)
       VALUES($1,'Candidate Warehouse',$2,true)`,
      [warehouseA, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
       VALUES
       ($1,$5,'Priced raw', $6,999,true),
       ($2,$7,'No-approved raw', $6,999,true),
       ($3,$8,'Other-branch raw', $9,999,true),
       ($4,$10,'Purchased raw', $6,999,true)`,
      [
        material, noApprovedPrice, foreignMaterial, purchasedMaterial,
        `price-${material.slice(0,8)}`, branchA,
        `noprice-${noApprovedPrice.slice(0,8)}`,
        `other-${foreignMaterial.slice(0,8)}`, branchB,
        `purchase-${purchasedMaterial.slice(0,8)}`,
      ],
    );
    for (const [id, raw, branch, price, ref, at] of [
      [randomUUID(), material, branchA, 10, 'FIRST', t0],
      [randomUUID(), material, branchA, 20, 'LATEST', t2],
      [randomUUID(), material, branchA, 30, 'FUTURE', future],
      [randomUUID(), foreignMaterial, branchB, 77, 'CROSS-BRANCH', t2],
    ] as const) {
      await client.query(
        `INSERT INTO public.raw_material_price_events
           (id,raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
         VALUES($1,$2,$3,$4,'pricing',$5,$6)`,
        [id, raw, branch, price, ref, at],
      );
    }
    await client.query(
      `INSERT INTO public.stock_counts(id,branch_id,warehouse_id,status,applied_at,count_number)
       VALUES($1,$2,$3,'applied',$4,'COUNT-CANDIDATE')`,
      [randomUUID(), branchA, warehouseA, t1],
    );
    // A second stock-count fixture has the same material and sits between
    // FIRST and LATEST; it must win for an as-of date in that interval.
    const stock = await client.query<{ id: string }>(
      "SELECT id FROM public.stock_counts WHERE branch_id=$1 AND count_number='COUNT-CANDIDATE' LIMIT 1",
      [branchA],
    );
    await client.query(
      `INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,unit_cost)
       VALUES($1,$2,15)`,
      [stock.rows[0].id, material],
    );

    await client.query(
      `INSERT INTO public.purchases(id,invoice_number,branch_id,subtotal,total,paid_amount,status,created_at)
       VALUES($1,'CANDIDATE-RECEIPT',$2,45,45,45,'completed',$3)`,
      [purchase, branchA, t2],
    );
    await client.query(
      `INSERT INTO public.inventory_ledger
         (raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,
          entry_type,reference_type,reference_id,reference_number,created_at)
       VALUES($1,$2,$3,1,45,45,'purchase','purchase',$4,'CANDIDATE-RECEIPT',$5)`,
      [purchasedMaterial, branchA, warehouseA, purchase, t2],
    );

    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES($1,$2,'Candidate Manager','branch_manager',$3,true)`,
      [manager, `${randomUUID()}@test.local`, branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('keeps historical prices at the precise dispatch time, never taking later prices', async () => {
    const beforeCount = await prices(branchA, [material], new Date(t0.getTime() + 10_000));
    expect(beforeCount).toHaveLength(1);
    expect(Number(beforeCount[0].unit_cost)).toBe(10);
    const afterCount = await prices(branchA, [material], new Date(t1.getTime() + 10_000));
    expect(Number(afterCount[0].unit_cost)).toBe(15);
    expect(afterCount[0].price_source).toBe('stock_count');
    const current = await prices(branchA, [material], asOf);
    expect(Number(current[0].unit_cost)).toBe(20);
    expect(current[0].price_source).toBe('pricing');
    const later = await prices(branchA, [material], afterFuture);
    expect(Number(later[0].unit_cost)).toBe(30);
  });

  it('preserves approval whitelist and never substitutes a default/FIFO cost', async () => {
    expect(await prices(branchA, [noApprovedPrice], asOf)).toEqual([]);
    expect(await prices(branchA, [material, foreignMaterial], asOf))
      .toHaveLength(1);
    expect(await prices(branchB, [material, foreignMaterial], asOf))
      .toMatchObject([{ raw_material_id: foreignMaterial, price_source: 'pricing' }]);
  });

  it('reads only a completed, qualified purchase as a candidate', async () => {
    const result = await prices(branchA, [purchasedMaterial], asOf);
    expect(result).toHaveLength(1);
    expect(result[0].price_source).toBe('purchase');
    expect(Number(result[0].unit_cost)).toBe(45);
    expect(result[0].reference_number).toBe('CANDIDATE-RECEIPT');
  });

  it('matches canonical visible current prices for the same branch and role', async () => {
    const expected = await client.query(
      `SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source
       FROM public.get_raw_material_current_prices($1,$2::uuid[])
       WHERE price_source IN ('purchase','pricing','stock_count')
       ORDER BY raw_material_id`,
      [branchA, [material, purchasedMaterial]],
    );
    // Canonical returns the future PRICING winner for material, which is
    // correct only for the later as-of; do NOT copy it into past snapshots.
    const actual = await prices(branchA, [material, purchasedMaterial], afterFuture);
    expect(actual.map(x => ({
      raw_material_id: x.raw_material_id, unit_cost: x.unit_cost, price_source: x.price_source,
    }))).toEqual(expected.rows);

    await client.query("SELECT set_config('app.user_id',$1,true)", [manager]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      const visible = await client.query(
        `SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source
         FROM public.get_raw_material_current_prices($1,$2::uuid[])
         WHERE price_source IN ('purchase','pricing','stock_count')
         ORDER BY raw_material_id`,
        [branchA, [material, purchasedMaterial]],
      );
      const candidate = await prices(branchA, [material, purchasedMaterial], afterFuture);
      expect(candidate.map(x => ({
        raw_material_id: x.raw_material_id, unit_cost: x.unit_cost, price_source: x.price_source,
      }))).toEqual(visible.rows);
    } finally {
      await client.query('RESET ROLE');
      await client.query('RESET app.user_id');
    }
  });

  it('does not enable or change the kitchen trigger in the sandbox', async () => {
    const r = await client.query(
      `SELECT t.tgenabled FROM pg_trigger t
       WHERE t.tgrelid='public.order_kitchen_inventory_events'::regclass
         AND t.tgname='trg_capture_kitchen_ingredient_prices'`,
    );
    expect(r.rows).toEqual([{ tgenabled: 'D' }]);
  });
});
