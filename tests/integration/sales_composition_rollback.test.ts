import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {getDbUrl,openDb} from './db';
const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const sql=(path:string)=>readFileSync(path,'utf8').replace(/^BEGIN;$/mg,'').replace(/^COMMIT;$/mg,'');
describe.skipIf(!local)('sales composition guarded recovery — owned localhost',()=>{
 it('restores and reapplies both exact definitions with unchanged security metadata',async()=>{
  const db=openDb(url!);await db.connect();await db.query('BEGIN');
  try {
   const query=`select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid in ('public.get_sold_recipe_consumption_report(uuid,date,date,text,text,integer,integer)'::regprocedure,'public._operational_report_source_result(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure) order by oid`;
   const before=(await db.query(query)).rows;
   await db.query(sql('scripts/rollback/sales_composition_reports_20261026.sql'));
   const restored=(await db.query(query)).rows;
   expect(restored.map(row=>row.hash).sort()).toEqual(['467c0cc51b69c456fb1921aad4b19f57','a58b8de62008d92dc6c3c8dfd428e0bc'].sort());
   await db.query(sql('supabase/migrations/20261026172551_sales_composition_report_views.sql'));
   expect((await db.query(query)).rows).toEqual(before);
   const security=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='hash'));
   expect(restored.map(security)).toEqual(before.map(security));
  }finally{await db.query('ROLLBACK');await db.end();}
 });
});
