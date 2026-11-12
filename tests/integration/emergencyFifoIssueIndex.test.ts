import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
const owned = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
describe.skipIf(!owned)('emergency FIFO issue index: owned disposable DB only', () => {
  let db: pg.Client;
  const branch = randomUUID(), warehouse = randomUUID(), raw = randomUUID();
  const old = readFileSync('scripts/rollback/operations_stability_original_functions_20261015.sql', 'utf8');
  const candidate = readFileSync('supabase/migrations/20261015200700_emergency_fifo_issue_lookup_order_matching.sql', 'utf8');
  const fn = (s: string) => s.slice(s.indexOf('CREATE OR REPLACE FUNCTION public._raw_last_known_fifo_cost'), s.indexOf('CREATE OR REPLACE FUNCTION public.update_order'));
  const indexSql = candidate.slice(candidate.indexOf('CREATE INDEX '), candidate.indexOf('CREATE OR REPLACE FUNCTION'));
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    // Reproduce the original 2026-10-15 experiment, not later receipt indexes.
    // Both drops are rolled back; the new indexes have their own WAL budget test.
    await db.query('DROP INDEX IF EXISTS public.idx_inventory_ledger_priced_receipt_recent');
    await db.query('DROP INDEX IF EXISTS public.idx_raw_batches_real_price_recent');
    await db.query('INSERT INTO public.branches(id,name) VALUES($1,$2)', [branch, 'Emergency index fixture']);
    await db.query('INSERT INTO public.warehouses(id,name,branch_id) VALUES($1,$2,$3)', [warehouse, 'Emergency W', branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost) VALUES($1,$2,'Emergency raw',$3,7.25)", [raw, randomUUID(), branch]);
    await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,batch_number,created_at)
      SELECT $1,$2,$3,-1,31.25,-31.25,'sale','REAL-'||g,now()-interval '1 day'+g*interval '1 second' FROM generate_series(1,3000) g`, [raw,branch,warehouse]);
  }, 60000);
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  it('returns the same exact price, bounds the latest lookup and avoids purchase WAL amplification', async () => {
    const args = [raw,branch,warehouse];
    async function cost() { return (await db.query('SELECT public._raw_last_known_fifo_cost($1,$2,$3)::text cost',args)).rows[0].cost; }
    async function read() {
      const p = (await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public._raw_last_known_fifo_cost($1,$2,$3)',args)).rows[0]['QUERY PLAN'][0];
      return { ms:p['Execution Time'], buffers:p.Plan['Shared Hit Blocks']+p.Plan['Shared Read Blocks'] };
    }
    async function purchase() {
      await db.query('SAVEPOINT receipt');
      try {
        const p = (await db.query(`EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON)
          INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type)
          SELECT $1,$2,$3,1,2,2,'purchase','purchase' FROM generate_series(1,64)`,args)).rows[0]['QUERY PLAN'][0];
        return { ms:p['Execution Time'], wal:p.Plan['WAL Bytes'] };
      } finally { await db.query('ROLLBACK TO SAVEPOINT receipt'); await db.query('RELEASE SAVEPOINT receipt'); }
    }
    await db.query('DROP INDEX public.idx_inventory_ledger_fifo_known_cost_recent');
    await db.query(fn(old));
    const expected = await cost(); expect(Number(expected)).toBe(31.25);
    await read(); await purchase();
    const before = [], writesBefore = [];
    for(let i=0;i<5;i++) { before.push(await read()); writesBefore.push(await purchase()); }
    await db.query(indexSql); await db.query(fn(candidate));
    expect(await cost()).toBe(expected);
    await read(); await purchase();
    const after = [], writesAfter = [];
    for(let i=0;i<5;i++) { after.push(await read()); writesAfter.push(await purchase()); }
    const median = (a:number[]) => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
    expect(median(after.map(x=>x.buffers))).toBeLessThan(median(before.map(x=>x.buffers))/5);
    expect(median(writesAfter.map(x=>x.wal))).toBeLessThanOrEqual(median(writesBefore.map(x=>x.wal))*1.1);
    const plan = (await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT il.unit_cost FROM public.inventory_ledger il
      WHERE il.raw_material_id=$1 AND il.branch_id=$2 AND il.warehouse_id=$3
        AND il.quantity<0 AND COALESCE(il.unit_cost,0)>0 AND COALESCE(il.batch_number,'') NOT LIKE 'OV-%'
      ORDER BY il.created_at DESC NULLS LAST,il.id DESC LIMIT 1`,args)).rows[0]['QUERY PLAN'][0];
    expect(JSON.stringify(plan)).toContain('idx_inventory_ledger_fifo_known_cost_recent');
    await db.query('SAVEPOINT exact_emergency_restore');
    try {
      await db.query(readFileSync('scripts/rollback/emergency_fifo_issue_lookup_order_matching_20261015.sql', 'utf8'));
      expect(await cost()).toBe(expected);
      expect((await db.query("SELECT to_regclass('public.idx_inventory_ledger_fifo_known_cost_recent') AS idx")).rows[0].idx).toBeNull();
    } finally { await db.query('ROLLBACK TO SAVEPOINT exact_emergency_restore'); await db.query('RELEASE SAVEPOINT exact_emergency_restore'); }
    expect(await cost()).toBe(expected);
    console.info('EMERGENCY_FIFO_ISSUE_INDEX '+JSON.stringify({source:'owned localhost synthetic fixture; not production p95',before,after,writesBefore,writesAfter,lookup:plan}));
  }, 120000);
});
