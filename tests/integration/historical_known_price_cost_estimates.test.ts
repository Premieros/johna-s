import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('historical zero consumption priced independently of stock balance', () => {
  let db: pg.Client;
  const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
  const admin = randomUUID(), raw = randomUUID(), unknown = randomUUID(), product = randomUUID();
  const legacy = randomUUID(), kitchen = randomUUID(), order = randomUUID(), item = randomUUID(), event = randomUUID();
  let ledger = 0;
  const asAdmin = async <T>(fn: () => Promise<T>) => {
    await db.query(`SELECT set_config('app.user_id',$1,true)`, [admin]);
    await db.query('SET LOCAL ROLE authenticated');
    try { return await fn(); } finally { await db.query('RESET ROLE'); await db.query('RESET app.user_id'); }
  };
  const estimates = () => asAdmin(async () => (await db.query(`SELECT public.get_historical_sale_cost_estimates($1,CURRENT_DATE-1,CURRENT_DATE+1) AS result`, [branch])).rows[0].result as { sale_id: string; estimated_cost: number; unpriced_movements: number }[]);

  beforeAll(async () => {
    db = openDb(dbUrl!); await db.connect(); await db.query('BEGIN');
    await db.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await db.query(`INSERT INTO public.organizations(id,name,slug) VALUES($1,'Historical Cost',$2)`, [org, `historical-${org}`]);
    await db.query(`INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Historical Branch',$2)`, [branch, org]);
    await db.query(`INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'History WH',$2,true)`, [warehouse, branch]);
    await db.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'Cost Admin','super_admin',$3,true)`, [admin, `${admin}@test.local`, branch]);
    const unit = (await db.query(`SELECT id FROM public.measurement_units WHERE code='KG' LIMIT 1`)).rows[0].id;
    await db.query(`INSERT INTO public.raw_materials(id,code,name,unit_id,branch_id,default_cost,is_active) VALUES($1,$2,'Known chicken',$3,$4,0,true),($5,$6,'Unpriced ingredient',$3,$4,0,true)`, [raw, `KNOWN-${raw}`, unit, branch, unknown, `UNKNOWN-${unknown}`]);
    await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,priced_at,reference_number) VALUES($1,$2,210,'pricing',now(),'HIST-PRICE-1')`, [raw, branch]);
    await db.query(`INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,-10,0)`, [raw, branch]);
    await db.query(`INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,'Historical Product',$2,100,0,true)`, [product, branch]);
    await db.query(`INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,status) VALUES($1,$2,$3,$4,100,100,100,'completed'),($5,$6,$3,$4,200,200,200,'completed')`, [legacy, `LEGACY-${legacy}`, branch, warehouse, kitchen, `KITCHEN-${kitchen}`]);
    ledger = Number((await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id) VALUES($1,$2,$3,-0.2,0,0,'sale','sale',$4) RETURNING id`, [raw, branch, warehouse, legacy])).rows[0].id);
    await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id) VALUES($1,$2,$3,-1,0,0,'sale','sale',$4)`, [unknown, branch, warehouse, legacy]);
    await db.query(`INSERT INTO public.orders(id,order_number,branch_id,order_type,status,inventory_warehouse_id) VALUES($1,$2,$3,'takeaway','completed',$4)`, [order, `ORDER-${order}`, branch, warehouse]);
    await db.query(`INSERT INTO public.order_items(id,order_id,product_id,unit_name,quantity,unit_price,total) VALUES($1,$2,$3,'piece',2,100,200)`, [item, order, product]);
    await db.query(`INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,voided_quantity,total_cost,settled_sale_id) VALUES($1,$2,$3,$4,$5,2,0.5,0,$6)`, [event, branch, warehouse, order, item, kitchen]);
    await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id) VALUES($1,$2,$3,-0.4,0,0,'kitchen_send','kitchen_send',$4)`, [raw, branch, warehouse, event]);
    // Defensive duplicate legacy source must not count when kitchen events exist.
    await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id) VALUES($1,$2,$3,-9,0,0,'sale','sale',$4)`, [raw, branch, warehouse, kitchen]);
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });

  it('preserves complete costing results at Cairo date boundaries and rehearses exact rollback', async () => {
    const migration = readFileSync('supabase/migrations/20261029195303_costing_date_range_read_optimization.sql', 'utf8');
    const rollback = readFileSync('scripts/rollback/costing_date_range_read_optimization_20261029.sql', 'utf8');
    const inTransaction = (sql: string) => sql.replace(/^BEGIN;$/gm, '').replace(/^COMMIT;$/gm, '');
    const metadata = async () => (await db.query(`SELECT proname,pg_get_functiondef(oid) definition,
      prosecdef,proowner,proacl,proconfig FROM pg_proc WHERE oid IN
      ('public.get_costing_sales_summary(uuid,date,date)'::regprocedure,
       'public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure) ORDER BY proname`)).rows;
    const before = await metadata();
    const ranges: (string | null)[][] = [
      ['2026-04-23', '2026-04-24'], ['2026-10-29', '2026-10-29'], ['2026-10-30', '2026-10-30'],
      [null, '2026-10-29'], ['2026-04-24', null], [null, null], ['-infinity', 'infinity'],
      ['0001-01-01', '12000-01-01'],
    ];
    const boundaryTimes = ['2026-04-23T21:59:59Z', '2026-04-23T22:00:00Z',
      '2026-10-29T20:59:59Z', '2026-10-29T21:00:00Z', '2026-10-29T21:59:59Z', '2026-10-29T22:00:00Z', null];
    const collect = async () => {
      const results: unknown[] = [];
      for (const timestamp of boundaryTimes) {
        await db.query(`UPDATE public.sales SET created_at=$1::timestamptz WHERE id=ANY($2::uuid[])`, [timestamp, [legacy, kitchen]]);
        for (const [from, to] of ranges) {
          results.push(await asAdmin(async () => (await db.query(`SELECT
            public.get_costing_sales_summary($1,$2,$3) summary,
            public.get_historical_sale_cost_estimates($1,$2,$3) estimates`, [branch, from, to])).rows));
        }
      }
      return results;
    };
    await db.query('SAVEPOINT costing_range_parity');
    try {
      const optimized = await collect();
      await db.query(inTransaction(rollback));
      const restored = await metadata();
      expect(restored.every(row => !row.definition.includes('COSTING_INDEXED_DATE_RANGE'))).toBe(true);
      expect(await collect()).toEqual(optimized);
      await db.query(inTransaction(migration));
      expect(await metadata()).toEqual(before);
      // Verify the exact candidate selection can use the existing timestamp index.
      const definition = before.find(row => row.proname === 'get_costing_sales_summary')!.definition as string;
      const ctes = definition.slice(definition.indexOf('WITH history_bounds'), definition.indexOf('scoped_sales AS MATERIALIZED'));
      expect(ctes).toContain('COSTING_INDEXED_DATE_RANGE');
      await db.query('SET LOCAL enable_seqscan=off');
      const plan = await db.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + ctes.replace(/\bp_branch_id\b/g, '$1::uuid').replace(/\bp_from\b/g, '$2::date').replace(/\bp_to\b/g, '$3::date').replace(/,\s*$/, '') +
        ' SELECT count(*) FROM date_candidates', [branch, '2026-10-29', '2026-10-29']);
      expect(JSON.stringify(plan.rows)).toMatch(/(?:Index Cond|Recheck Cond|Join Filter|Filter)[^}]*created_at/);
      const scans: Record<string, unknown>[] = [];
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        const node = value as Record<string, unknown>;
        if (node['Relation Name'] === 'sales' && Number(node['Actual Loops']) > 0) scans.push(node);
        Object.values(node).forEach(visit);
      };
      visit(plan.rows);
      expect(scans.length).toBeGreaterThan(0);
      for (const node of scans) {
        const condition = String(node['Index Cond'] || node['Recheck Cond']);
        expect(String(node['Node Type'])).toMatch(/Index|Bitmap/);
        if (!condition.includes('created_at')) {
          // This branch owns only two fixture invoices. PostgreSQL may cheaply
          // read that branch index and apply dates at the bounds join instead
          // of parameterizing the timestamp index. Reject an unbounded scan,
          // but do not require an arbitrary join order for two rows.
          expect(condition).toContain('branch_id');
          const visited = (Number(node['Actual Rows'] || 0) + Number(node['Rows Removed by Filter'] || 0)) * Number(node['Actual Loops']);
          expect(visited).toBeLessThanOrEqual(2);
        }
      }
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT costing_range_parity');
    }
  });
  it('prices past zero movements at the known price with negative, zero or positive current stock', async () => {
    for (const quantity of [-10, 0, 10]) {
      await db.query(`UPDATE public.raw_material_inventory SET quantity=$1 WHERE raw_material_id=$2 AND branch_id=$3`, [quantity, raw, branch]);
      const rows = await estimates();
      expect(Number(rows.find(r => r.sale_id === legacy)?.estimated_cost)).toBe(42);
      expect(Number(rows.find(r => r.sale_id === legacy)?.unpriced_movements)).toBe(1);
      expect(Number(rows.find(r => r.sale_id === kitchen)?.estimated_cost)).toBe(63);
    }
    const source = (await db.query(`SELECT unit_cost,total_cost,quantity FROM public.inventory_ledger WHERE id=$1`, [ledger])).rows[0];
    expect(Number(source.total_cost)).toBe(0); expect(Number(source.quantity)).toBe(-0.2);
    const period = await asAdmin(async () => (await db.query(`SELECT estimated_cost FROM public.get_raw_consumption_cost_breakdown($1,now()-interval '1 day',now()+interval '1 day') WHERE raw_material_id=$2`, [branch, raw])).rows[0]);
    expect(Number(period.estimated_cost)).toBe(2016); // (0.2 + 0.4 + 9) * 210; unchanged raw-movement scope
    await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,priced_at,reference_number) VALUES($1,$2,310,'pricing',now()+interval '1 minute','HIST-PRICE-2')`, [raw, branch]);
    const repriced = await estimates();
    expect(Number(repriced.find(r => r.sale_id === legacy)?.estimated_cost)).toBe(62);
    expect(Number(repriced.find(r => r.sale_id === kitchen)?.estimated_cost)).toBe(93);
  });
  it('does not add an estimate after actual receipt cost replaces the zero', async () => {
    await db.query(`UPDATE public.inventory_ledger SET unit_cost=210,total_cost=-42 WHERE id=$1`, [ledger]);
    const row = (await estimates()).find(r => r.sale_id === legacy);
    expect(Number(row?.estimated_cost)).toBe(0);
    expect(Number(row?.unpriced_movements)).toBe(1);
  });
  it('excludes cancelled and returned sales and fully voided kitchen consumption', async () => {
    await db.query(`UPDATE public.sales SET status='returned' WHERE id=$1`, [legacy]);
    await db.query(`UPDATE public.order_kitchen_inventory_events SET voided_quantity=sent_quantity WHERE id=$1`, [event]);
    expect(await estimates()).toEqual([]);
  });
  it('preserves invoker security and denies anonymous execution', async () => {
    const result = await db.query(`SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon_access FROM pg_proc p WHERE p.oid='public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure`);
    expect(result.rows[0]).toEqual({ prosecdef: false, anon_access: false });
  });
  it('denies a costing viewer access to a foreign branch without weakening RLS', async () => {
    const viewer = randomUUID(), foreignBranch = randomUUID();
    await db.query(`INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Foreign history branch',$2)`, [foreignBranch, org]);
    await db.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,is_active) VALUES('historical_cost_viewer','مشاهد التكلفة','History Viewer','["reports.costing","sales.view","raw_materials.view"]',true) ON CONFLICT(role) DO UPDATE SET permissions=EXCLUDED.permissions`);
    await db.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'Branch Viewer','historical_cost_viewer',$3,true)`, [viewer, `${viewer}@test.local`, branch]);
    await db.query('SAVEPOINT foreign_guard');
    await db.query(`SELECT set_config('app.user_id',$1,true)`, [viewer]);
    await db.query('SET LOCAL ROLE authenticated');
    try { await expect(db.query(`SELECT * FROM public.get_historical_sale_cost_estimates($1,CURRENT_DATE,CURRENT_DATE)`, [foreignBranch])).rejects.toThrow('BRANCH_MISMATCH'); }
    finally { await db.query('ROLLBACK TO SAVEPOINT foreign_guard'); await db.query('RESET ROLE'); await db.query('RESET app.user_id'); }
  });
});
