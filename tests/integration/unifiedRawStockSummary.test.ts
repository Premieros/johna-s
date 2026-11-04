import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

describe.skipIf(!local)('unified current raw stock / published price, owned localhost', () => {
  let db: pg.Client;
  const a = randomUUID(), b = randomUUID(), wh = randomUUID(), wh2 = randomUUID();
  const raw = randomUUID(), empty = randomUUID(), foreign = randomUUID(), viewer = randomUUID();
  const fingerprints = async () => (await db.query(`
    SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\n' ORDER BY p.oid)) value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN('_raw_add','_raw_remove_fifo',
     '_raw_fifo_settle_receipt','send_to_kitchen','process_sale_idempotent',
     'claim_cloud_print_jobs','apply_stock_count')`)).rows[0].value;
  let before: string;
  beforeAll(async () => {
    db = openDb(url); await db.connect(); await db.query('BEGIN');
    before = await fingerprints();
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Summary A'),($2,'Summary B')", [a,b]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'Summary WH',$2,true),($3,'Summary WH2',$2,true)", [wh,a,wh2]);
    for (const [id, branch] of [[raw,a],[empty,a],[foreign,b]]) {
      await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,min_stock) VALUES($1,$2,'Summary raw',$3,0,7)", [id,id,branch]);
    }
    await db.query(`INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type)
      VALUES($1,$2,$3,'SUMMARY-POS',5,4,'opening'),($1,$2,$3,'SUMMARY-NEG',-2,0,'opening'),($1,$2,$4,'SUMMARY-OTHER',1,1,'opening')`, [raw,a,wh,wh2]);
    // A stale compatibility projection must never become another stock source.
    await db.query(`INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost,min_stock)
      VALUES($1,$2,777,999,99) ON CONFLICT(raw_material_id,branch_id)
      DO UPDATE SET quantity=777,avg_cost=999,min_stock=99`, [raw,a]);
    await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at)
      VALUES($1,$2,10,'SUMMARY-PRICE',clock_timestamp()-interval '1 second'),($3,$4,77,'FOREIGN-PRICE',clock_timestamp()-interval '1 second')`, [raw,a,foreign,b]);
    await db.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await db.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,is_active)
      VALUES('summary_reader','قارئ رصيد','Summary reader','["raw_materials.view","inventory.view","history.unlimited"]',true)
      ON CONFLICT(role) DO UPDATE SET permissions=EXCLUDED.permissions`);
    await db.query("INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'Summary viewer','summary_reader',$3,true)", [viewer,viewer+'@test.local',a]);
    await db.query("SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)", [viewer]);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:viewer,role:'authenticated'})]);
    await db.query('SET LOCAL ROLE authenticated');
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });

  it('sums positive and negative warehouse lots, ignores stale summary cost/quantity and shares the price RPC', async () => {
    const rows = (await db.query('SELECT * FROM public.get_raw_material_stock_summary($1,0,500)', [a])).rows;
    const line = rows.find(row => row.raw_material_id === raw);
    expect(Number(line.quantity)).toBe(4);
    expect(Number(line.min_stock)).toBe(7);
    expect(Number(line.avg_cost)).toBe(10);
    expect(Number(line.quantity) * Number(line.avg_cost)).toBe(40);
    expect(line.price_source).toBe('pricing');
    const price = (await db.query('SELECT * FROM public.get_raw_material_current_prices($1,$2)', [a,[raw]])).rows[0];
    expect(line.avg_cost).toBe(price.unit_cost);
    expect(line.raw_material.id).toBe(raw);
    expect(line.branch.id).toBe(a);
  });
  it('keeps zero as a real price, returns each material once and pages without repeating or losing rows', async () => {
    const all = (await db.query('SELECT * FROM public.get_raw_material_stock_summary($1,0,500)', [a])).rows;
    const zero = all.find(row => row.raw_material_id === empty);
    expect(Number(zero.quantity)).toBe(0); expect(Number(zero.avg_cost)).toBe(0);
    expect(zero.price_source).toBe('catalog_zero');
    const pages = [];
    for (let offset=0;offset<3;offset++) pages.push(...(await db.query('SELECT * FROM public.get_raw_material_stock_summary($1,$2,1)', [a,offset])).rows);
    expect(pages.map(row => row.id)).toEqual(all.map(row => row.id));
    expect(new Set(pages.map(row => row.id)).size).toBe(2);
  });
  it('does not expose another branch through an unfiltered request or a foreign explicit material price', async () => {
    expect((await db.query('SELECT * FROM public.get_raw_material_stock_summary(NULL,0,500)')).rows.every(row => row.branch_id === a)).toBe(true);
    expect((await db.query('SELECT * FROM public.get_raw_material_current_prices($1,$2)', [b,[foreign]])).rows).toEqual([]);
    await db.query('SAVEPOINT denied');
    await expect(db.query('SELECT * FROM public.get_raw_material_stock_summary($1,0,500)', [b])).rejects.toThrow('BRANCH_MISMATCH');
    await db.query('ROLLBACK TO denied'); await db.query('RELEASE denied');
  });
  it('rejects unbounded pages and anonymous reads, leaving core writer definitions unchanged', async () => {
    await db.query('SAVEPOINT bad_page');
    await expect(db.query('SELECT * FROM public.get_raw_material_stock_summary($1,0,501)', [a])).rejects.toThrow('INVALID_PAGE');
    await db.query('ROLLBACK TO bad_page'); await db.query('RELEASE bad_page');
    await db.query('RESET ROLE');
    expect((await db.query("SELECT has_function_privilege('anon','public.get_raw_material_stock_summary(uuid,integer,integer)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    expect(await fingerprints()).toBe(before);
    await db.query('SET LOCAL ROLE authenticated');
  });
});
