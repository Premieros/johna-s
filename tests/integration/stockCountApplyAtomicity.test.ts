import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// Only the disposable local CI database is eligible; all fixtures ROLLBACK.
const url = getDbUrl();
let local = false;
try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); }
catch { /* No local test DB. */ }

describe.skipIf(!local)('stock count apply is atomic on late FIFO shortage', () => {
  let db: pg.Client;
  const branch = randomUUID(), warehouse = randomUUID(), actor = randomUUID();
  const firstProduct = randomUUID(), shortProduct = randomUUID(), count = randomUUID();
  // Deterministic order: the successful addition MUST precede the shortage.
  const firstLine = '00000000-0000-4000-8000-000000000001';
  const secondLine = '00000000-0000-4000-8000-000000000002';

  beforeAll(async () => {
    db = openDb(url); await db.connect(); await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Atomic count QA')", [branch]);
    await db.query("INSERT INTO public.warehouses(id,branch_id,name,is_active) VALUES($1,$2,'Atomic QA WH',true)", [warehouse, branch]);
    await db.query("INSERT INTO public.products(id,name,branch_id,cost_price,sale_price) VALUES($1,'Add product',$3,10,20),($2,'Short product',$3,10,20)", [firstProduct, shortProduct, branch]);
    // Deliberately inconsistent inventory-vs-FIFO fixture: the second product
    // claims 1 on hand but has no batch to remove. This is NOT production data.
    await db.query('INSERT INTO public.inventory(product_id,warehouse_id,branch_id,quantity) VALUES($1,$3,$4,0),($2,$3,$4,1)', [firstProduct, shortProduct, warehouse, branch]);
    await db.query("SELECT set_config('app.register_branch','on',true)");
    await db.query("INSERT INTO public.users(id,email,role,branch_id,is_active) VALUES($1,$2,'warehouse_manager',$3,true)", [actor, actor + '@atomic.test', branch]);
    await db.query("SELECT set_config('app.register_branch','off',true)");
    // CI role seeds vary; grant only the count-apply capability in this
    // rollback-only fixture, matching the production warehouse manager role.
    await db.query("UPDATE public.roles SET permissions=(COALESCE(permissions,'[]'::jsonb)||'[\"inventory.count.apply\"]'::jsonb) WHERE role='warehouse_manager'");
    await db.query(`INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at)
      VALUES($1,'QA-ATOMIC-'||left($1::text,8),$2,$3,'approved','partial',$4,$4,now())`, [count, branch, warehouse, actor]);
    await db.query(`INSERT INTO public.stock_count_items(id,stock_count_id,product_id,system_quantity,counted_quantity,unit_cost)
      VALUES($1,$3,$4,0,1,10),($2,$3,$5,1,0,10)`, [firstLine, secondLine, count, firstProduct, shortProduct]);
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)", [actor]);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:actor,role:'authenticated'})]);
    await db.query('SET LOCAL ROLE authenticated');
  }, 45000);

  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });

  it('rolls back earlier stock, batch, ledger and transaction writes if a later line fails', async () => {
    const result = (await db.query<{result: {success:boolean;error?:string;shortage?:number}}>(
      'SELECT public.apply_stock_count($1) result', [count]
    )).rows[0].result;
    expect(result).toMatchObject({success:false,error:'STOCK_COUNT_SHORTAGE'});
    expect(Number(result.shortage)).toBeGreaterThan(0);

    // Assert as the test DB owner so RLS cannot hide a leaked posting.
    await db.query('RESET ROLE');
    const inventory = (await db.query<{product_id:string;quantity:string}>(
      'SELECT product_id,quantity FROM public.inventory WHERE warehouse_id=$1', [warehouse]
    )).rows;
    expect(Number(inventory.find(x => x.product_id === firstProduct)?.quantity)).toBe(0);
    expect(Number(inventory.find(x => x.product_id === shortProduct)?.quantity)).toBe(1);
    for (const table of ['inventory_batches','inventory_ledger','stock_transactions','journal_entries']) {
      const referenceColumn = table === 'inventory_batches' ? 'source_id' : 'reference_id';
      const {rows} = await db.query<{n:number}>(`SELECT count(*)::int n FROM public.${table} WHERE ${referenceColumn}=$1`, [count]);
      expect(rows[0].n, `${table} must be rolled back`).toBe(0);
    }
    const status = (await db.query<{status:string;applied_at:string|null}>(
      'SELECT status,applied_at FROM public.stock_counts WHERE id=$1', [count]
    )).rows[0];
    expect(status).toEqual({status:'approved',applied_at:null});
  });
});
