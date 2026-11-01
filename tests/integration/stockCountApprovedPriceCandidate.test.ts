import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// Never execute the NOT-FOR-PRODUCTION function against a shared database.
// Local CI fixtures are transaction-scoped and rolled back unconditionally.
const url = getDbUrl();
let local = false;
try { local = ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname); } catch { /* no DB */ }

describe.skipIf(!local)('latest-price stock count candidate in disposable database', () => {
  let db: pg.Client;
  const branch=randomUUID(), warehouse=randomUUID(), actor=randomUUID();
  const raw=randomUUID(), shortRaw=randomUUID(), count=randomUUID();
  beforeAll(async () => {
    db=openDb(url); await db.connect(); await db.query('BEGIN');
    const candidate=readFileSync('scripts/candidates/stock_count_apply_last_price_ATOMIC_NOT_FOR_PRODUCTION_20261101.sql','utf8');
    await db.query(candidate);
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Latest price QA')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,branch_id,name,is_active) VALUES($1,$2,'Latest price QA WH',true)",[warehouse,branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Zero cost raw',$3,0,true)",[raw,'QA-'+raw.slice(0,8),branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'FIFO cost test raw',$3,0,true)",[shortRaw,'QA-'+shortRaw.slice(0,8),branch]);
    const initial=(await db.query("SELECT public._raw_add($1,$2,$3,5,12,NULL,NULL,NULL,'adjustment','qa_seed',NULL,NULL,NULL) r",[shortRaw,branch,warehouse])).rows[0].r;
    if (!initial?.success) throw new Error('QA_INITIAL_RAW_ADD_FAILED '+JSON.stringify(initial));
    await db.query("SELECT set_config('app.register_branch','on',true)");
    await db.query("INSERT INTO public.users(id,email,role,branch_id,is_active) VALUES($1,$2,'warehouse_manager',$3,true)",[actor,actor+'@latest-price.test',branch]);
    await db.query("SELECT set_config('app.register_branch','off',true)");
    await db.query("UPDATE public.roles SET permissions=(COALESCE(permissions,'[]'::jsonb)||'[\"inventory.count.apply\"]'::jsonb) WHERE role='warehouse_manager'");
    await db.query("INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at) VALUES($1,$5,$2,$3,'approved','partial',$4,$4,now())",[count,branch,warehouse,actor,'QA-ZERO-'+count.slice(0,8)]);
    await db.query("INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,system_quantity,counted_quantity,unit_cost) VALUES($1,$2,0,3,0),($1,$3,5,2,0)",[count,raw,shortRaw]);
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)",[actor]);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);
    await db.query('SET LOCAL ROLE authenticated');
  },45000);
  afterAll(async () => { if(db){ await db.query('ROLLBACK').catch(()=>{}); await db.end(); } });
  it('applies zero-priced surplus while preserving quantity and zero-valued ledger', async () => {
    const {rows}=await db.query('SELECT public.apply_stock_count($1) result',[count]);
    expect(rows[0].result.success,JSON.stringify(rows[0].result)).toBe(true);
    await db.query('RESET ROLE');
    const result=(await db.query("SELECT status FROM public.stock_counts WHERE id=$1",[count])).rows[0];
    expect(result.status).toBe('applied');
    const items=(await db.query("SELECT raw_material_id,unit_cost,counted_quantity FROM public.stock_count_items WHERE stock_count_id=$1",[count])).rows;
    expect(Number(items[0].unit_cost)).toBe(0);
    expect(items).toHaveLength(2);
    expect(items.every(x=>Number(x.unit_cost)===0)).toBe(true);
    expect(Number(items.find(x=>x.raw_material_id===raw)?.counted_quantity)).toBe(3);
    expect(Number(items.find(x=>x.raw_material_id===shortRaw)?.counted_quantity)).toBe(2);
    const ledger=(await db.query("SELECT COALESCE(sum(quantity),0) q,COALESCE(sum(total_cost),0) v FROM public.inventory_ledger WHERE reference_id=$1 AND reference_type='stock_count'",[count])).rows[0];
    expect(Number(ledger.q)).toBe(0);
    expect(Number(ledger.v)).toBe(0);
    const bridge=(await db.query("SELECT quantity,total_cost,before_qty,after_qty FROM public.inventory_ledger WHERE reference_id=$1 AND raw_material_id=$2 AND entry_type='revaluation'",[count,shortRaw])).rows;
    expect(bridge).toHaveLength(1);
    expect(Number(bridge[0].quantity)).toBe(0);
    expect(Number(bridge[0].total_cost)).toBe(36);
    expect(Number(bridge[0].after_qty)).toBe(2);
  });
});
