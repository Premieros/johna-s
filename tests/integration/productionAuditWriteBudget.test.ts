import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type pg from 'pg';
import {getDbUrl,openDb} from './db';
const url=getDbUrl();
const owned=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const sql=readFileSync('scripts/db/candidates/production_audit_repairs.sql','utf8');
const median=(rows:number[])=>[...rows].sort((a,b)=>a-b)[Math.floor(rows.length/2)];
describe.skipIf(!owned)('audit fallback index WAL budgets: owned synthetic tables only',()=>{
 let db:pg.Client;
 beforeAll(async()=>{db=openDb(url!);await db.connect();await db.query('BEGIN');});
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 it.each([
  ['inventory_ledger','idx_inventory_ledger_priced_receipt_recent'],
  ['raw_material_batches','idx_raw_batches_real_price_recent'],
 ])('caps positive receipt overhead and excludes sale/debt rows for %s',async(source,index)=>{
  const suffix=randomUUID().replace(/-/g,'');const table='public.qa_audit_write_'+suffix;
  // Logged regular tables, not TEMP/UNLOGGED: WAL must be measurable. All roll back.
  await db.query(`CREATE TABLE ${table}(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
   raw_material_id uuid,branch_id uuid,warehouse_id uuid,quantity numeric,unit_cost numeric,
   entry_type text,reference_type text,source_type text,created_at timestamptz DEFAULT now())`);
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  async function write(negative=false){
   await db.query('SAVEPOINT wal_sample');
   try{
    const result=await db.query(`EXPLAIN (ANALYZE,WAL,FORMAT JSON) INSERT INTO ${table}
     (raw_material_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,reference_type,source_type)
     SELECT $1,$2,$3,${negative?-1:1},2,'${negative?'sale':'purchase'}','${negative?'sale':'purchase'}','${negative?'sale_oversold':'purchase'}'
     FROM generate_series(1,64)`,ids);
    return Number(result.rows[0]['QUERY PLAN'][0].Plan['WAL Bytes']);
   }finally{await db.query('ROLLBACK TO SAVEPOINT wal_sample');await db.query('RELEASE SAVEPOINT wal_sample');}
  }
  async function samples(negative=false){await write(negative);const values=[];for(let n=0;n<3;n++)values.push(await write(negative));return median(values);}
  const positiveBefore=await samples(),negativeBefore=await samples(true);
  const match=sql.match(new RegExp('CREATE INDEX IF NOT EXISTS '+index+'[\\s\\S]*?;'));
  expect(match).not.toBeNull();
  await db.query(match![0].replace(index,'qa_audit_index_'+suffix).replace('public.'+source,table));
  const positiveAfter=await samples(),negativeAfter=await samples(true);
  expect(positiveBefore).toBeGreaterThan(0);
  expect((positiveAfter-positiveBefore)/64).toBeLessThanOrEqual(1024);
  expect((negativeAfter-negativeBefore)/64).toBeLessThanOrEqual(64);
  console.info('AUDIT_INDEX_WAL '+JSON.stringify({index,positiveBefore,positiveAfter,negativeBefore,negativeAfter,addedBytesPerReceipt:(positiveAfter-positiveBefore)/64,source:'owned logged synthetic table; not production latency'}));
 });
});
