import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {getDbUrl,openDb} from './db';

const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
const sql=(path:string)=>readFileSync(path,'utf8').replace(/^BEGIN;$/mg,'').replace(/^COMMIT;$/mg,'');

describe.skipIf(!local)('sales composition guarded recovery — owned localhost',()=>{
  it('fails closed when later purchase-report changes make the historical rollback unsafe',async()=>{
    const db=openDb(url!);await db.connect();await db.query('BEGIN');
    try {
      const query=`select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) hash,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid in ('public.get_sold_recipe_consumption_report(uuid,date,date,text,text,integer,integer)'::regprocedure,'public._operational_report_source_result(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure) order by oid`;
      const before=(await db.query(query)).rows;
      // A purchase-report revision migration intentionally changes the same shared
      // function after the older sales-composition patch. Its original rollback
      // must reject drift rather than silently erase the purchase correction.
      const report=(await db.query(`select pg_get_functiondef('public._operational_report_source_result(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure) as definition`)).rows[0].definition as string;
      expect(report).toContain("t.invoice_number ~ '-REV-[0-9a-fA-F]{8}$'");
      await db.query('SAVEPOINT guarded_recovery');
      await expect(db.query(sql('scripts/rollback/sales_composition_reports_20261026.sql')))
        .rejects.toThrow(/SALES_SOURCE_ROLLBACK_DRIFT/);
      await db.query('ROLLBACK TO SAVEPOINT guarded_recovery');
      expect((await db.query(query)).rows).toEqual(before);
    }finally{await db.query('ROLLBACK');await db.end();}
  });
});
