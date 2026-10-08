import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { reportDateRangeUtc } from '../../src/lib/businessTime';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

type Page = { rows: Record<string, unknown>[]; summary: { total: number; count: number } };
const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('operational pages retain direct caller RLS totals', () => {
  let client: pg.Client; let ids: RlsIds;
  const prefix = `OP-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='8s'");
    if (!await canImpersonate(client)) throw new Error('Requires isolated CI auth stub');
    ids = await seedRlsFixture(client);
    await client.query(`INSERT INTO public.sales
      (invoice_number,branch_id,warehouse_id,cashier_id,customer_id,subtotal,total,paid_amount,refunded_amount,payment_method,status,created_at)
      SELECT $1 || '-' || n,$2,$3,$4,$5,10,10,6,2,'cash','completed',now()
      FROM generate_series(1,205) n`, [prefix,ids.branchA,ids.whA,ids.users.cashier,ids.custA]);
    await client.query(`INSERT INTO public.expenses
      (branch_id,category,description,amount,expense_date,payment_method,status,account_id)
      VALUES ($1,$2,'page expense',12.34,CURRENT_DATE,'cash','posted',$3),
             ($1,$2,'voided excluded',999,CURRENT_DATE,'cash','voided',$3)`,
      [ids.branchA,prefix,ids.coaCashA]);
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });
  async function page(type='sales',user=ids.users.cashier,branch: string | null=ids.branchA,page=0,filters: object={ cashier: ids.users.cashier }): Promise<Page> {
    const result = await runAs(client,user,
      `SELECT public.get_operational_report_page($1,$2,CURRENT_DATE-60,CURRENT_DATE+1,$3,$4,100) AS page`,
      [type,branch,filters,page]);
    expect(result.error).toBeUndefined(); return result.rows[0].page as Page;
  }
  it('returns 100 details but totals cover all 205 visible invoices, including refunds', async () => {
    const first=await page(); expect(first.rows).toHaveLength(100);
    expect(first.summary).toEqual({total:1640,count:205});
    expect(first.rows[0].customer).toEqual({name:'CustA'});
    expect(first.rows[0].total).toBe(10); expect(first.rows[0].refunded_amount).toBe(2);
  });
  it('collects all pages exactly once with deterministic ordering even when timestamps tie', async () => {
    const collected: unknown[] = [];
    for (const n of [0,1,2]) collected.push(...(await page('sales',ids.users.cashier,ids.branchA,n)).rows.map(r=>r.id));
    const legacy=await runAs(client,ids.users.cashier,
      `SELECT id FROM public.sales WHERE branch_id=$1 AND cashier_id=$2 ORDER BY created_at DESC,id DESC`,[ids.branchA,ids.users.cashier]);
    expect(collected).toEqual(legacy.rows.map(r=>r.id)); expect(new Set(collected).size).toBe(205);
  });
  it('preserves branch isolation in details and totals and keeps missing joins unavailable', async () => {
    expect((await page('sales',ids.users.cashier_b)).summary).toEqual({total:0,count:0});
    const foreign=await page('sales',ids.users.cashier_b,ids.branchA);
    expect(foreign.rows).toEqual([]);
    const manager=await page('sales',ids.users.warehouse_manager,ids.branchA);
    const legacy=await runAs(client,ids.users.warehouse_manager,
      `SELECT count(*)::integer AS count,coalesce(sum(greatest(total-coalesce(refunded_amount,0),0)),0)::float AS total
       FROM public.sales WHERE branch_id=$1 AND cashier_id=$2`,[ids.branchA,ids.users.cashier]);
    expect(manager.summary).toEqual(legacy.rows[0]);
  });
  it('keeps exact purchase and posted-expense totals/filters, with the expense account relation', async () => {
    const expense=await page('expenses',ids.users.super_admin,ids.branchA,0,{category:prefix,payment_method:'cash'});
    expect(expense.summary).toEqual({total:12.34,count:1});
    expect(expense.rows[0].expense_account).toMatchObject({code:expect.any(String),name:expect.any(String)});
    expect((await page('expenses',ids.users.super_admin,ids.branchA,0,{category:prefix,payment_method:'card'})).summary.count).toBe(0);
    const purchase=await page('purchases',ids.users.cashier,ids.branchA,0,{supplier:ids.suppA,warehouse:ids.whA,status:'completed'});
    const legacy=await runAs(client,ids.users.cashier,
      `SELECT count(*)::integer AS count,coalesce(sum(greatest(coalesce(total,0)-coalesce(returned_amount,0),0)),0)::float AS total
       FROM public.purchases WHERE branch_id=$1 AND supplier_id=$2 AND warehouse_id=$3 AND status='completed'`,[ids.branchA,ids.suppA,ids.whA]);
    expect(purchase.summary).toEqual(legacy.rows[0]);
  });
  it('uses one canonical source for full exports and compact server comparison metrics', async () => {
    const result=await runAs(client,ids.users.cashier,
      `SELECT public.get_operational_report_dataset('sales',$1,CURRENT_DATE-60,CURRENT_DATE+1,$2) AS dataset,
        public.get_operational_report_metrics('sales',$1,CURRENT_DATE-60,CURRENT_DATE+1,$2) AS metrics`,
      [ids.branchA,{cashier:ids.users.cashier}]);
    expect(result.error).toBeUndefined();
    const dataset=result.rows[0].dataset as Page;
    expect(dataset.rows).toHaveLength(205);
    expect(dataset.summary).toEqual((await page()).summary);
    expect(new Set(dataset.rows.map(row=>row.id)).size).toBe(205);
    expect(result.rows[0].metrics).toMatchObject({'Net Sales':1640,'Paid':1230,'Refunded':410,'Net Collection':820});
    const bounded=await runAs(client,ids.users.cashier,
      `SELECT public._operational_report_source_result('sales',$1,CURRENT_DATE-60,CURRENT_DATE+1,$2,0,0) AS compact`,
      [ids.branchA,{cashier:ids.users.cashier}]);
    expect((bounded.rows[0].compact as Page).rows).toEqual([]);
    for (const name of ['get_operational_report_dataset','get_operational_report_metrics']) {
      const foreign=await runAs(client,ids.users.cashier_b,
        `SELECT public.${name}('sales',$1,CURRENT_DATE-60,CURRENT_DATE+1,$2) AS value`,[ids.branchA,{cashier:ids.users.cashier}]);
      expect(foreign.error).toBeUndefined();
      if (name.endsWith('dataset')) expect((foreign.rows[0].value as Page).rows).toEqual([]);
      else expect((foreign.rows[0].value as Record<string,number>)['Net Sales']).toBe(0);
    }
    const acl=await client.query(`SELECT proname,prosecdef,has_function_privilege('anon',oid,'EXECUTE') AS anon_execute
      FROM pg_proc WHERE proname IN ('get_operational_report_dataset','get_operational_report_metrics') ORDER BY proname`);
    expect(acl.rows).toEqual([
      {proname:'get_operational_report_dataset',prosecdef:false,anon_execute:false},
      {proname:'get_operational_report_metrics',prosecdef:false,anon_execute:false},
    ]);
  });

  it('never includes financially hidden history in summaries or details', async () => {
    await client.query(`UPDATE public.sales SET created_at=now()-interval '30 days' WHERE invoice_number LIKE $1 || '%'`,[prefix]);
    for (const user of [ids.users.cashier,ids.users.super_admin]) {
      const result=await page('sales',user);
      const direct=await runAs(client,user,
        `SELECT count(*)::integer AS count,coalesce(sum(greatest(total-coalesce(refunded_amount,0),0)),0)::float AS total
         FROM public.sales WHERE branch_id=$1 AND cashier_id=$2`,[ids.branchA,ids.users.cashier]);
      expect(result.summary).toEqual(direct.rows[0]);
      expect(result.rows.length).toBe(Math.min(100,result.summary.count));
    }
  });
  it('uses the same explicit UTC bounds as full reads across Cairo DST transitions', async () => {
    for (const date of ['2026-04-24','2026-10-30']) {
      const bounds=reportDateRangeUtc(date,date);
      await client.query(`INSERT INTO public.sales
        (invoice_number,branch_id,warehouse_id,cashier_id,subtotal,total,paid_amount,payment_method,status,created_at)
        VALUES ($1,$2,$3,$4,7,7,7,'cash','completed',$5::timestamptz+interval '1 second'),
               ($1||'-outside',$2,$3,$4,99,99,99,'cash','completed',$5::timestamptz-interval '1 second')`,
        [`${prefix}-${date}`,ids.branchA,ids.whA,ids.users.cashier,bounds.startIso]);
      const result=await runAs(client,ids.users.super_admin,
        `SELECT public.get_operational_report_page('sales',$1,$2,$2,$3,0,100,$4,$5) AS page,
          (SELECT jsonb_build_object('count',count(*),'total',coalesce(sum(greatest(coalesce(total,0)-coalesce(refunded_amount,0),0)),0))
           FROM public.sales WHERE branch_id=$1 AND cashier_id=$6 AND created_at>=$4::timestamptz AND created_at<$5::timestamptz) AS direct`,
        [ids.branchA,date,{cashier:ids.users.cashier},bounds.startIso,bounds.endExclusiveIso,ids.users.cashier]);
      expect(result.error).toBeUndefined(); expect((result.rows[0].page as Page).summary).toEqual(result.rows[0].direct);
      expect((result.rows[0].page as Page).summary).toEqual({count:1,total:7});
    }
  });

  it('is an authenticated invoker API and rejects invalid paging/date/type inputs', async () => {
    const fn=await client.query(`SELECT prosecdef,provolatile,
      has_function_privilege('anon',oid,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',oid,'EXECUTE') AS auth_execute
      FROM pg_proc WHERE oid='public.get_operational_report_page(text,uuid,date,date,jsonb,integer,integer,timestamptz,timestamptz)'::regprocedure`);
    expect(fn.rows).toEqual([{prosecdef:false,provolatile:'s',anon_execute:false,auth_execute:true}]);
    for (const args of [['other',0,100],['sales',-1,100],['sales',0,201],['sales',null,100]]) {
      const result=await runAs(client,ids.users.cashier,
        `SELECT public.get_operational_report_page($1,$2,CURRENT_DATE,CURRENT_DATE,'{}',$3,$4)`,[args[0],ids.branchA,args[1],args[2]]);
      expect(result.error).toMatch(/REPORT_(TYPE|PAGE)_INVALID/);
    }
    const reversed=await runAs(client,ids.users.cashier,
      `SELECT public.get_operational_report_page('sales',$1,CURRENT_DATE,CURRENT_DATE-1)`,[ids.branchA]);
    expect(reversed.error).toContain('REPORT_PERIOD_INVALID');
  });
  it('shares invoice identity, complete lines and server return/dimension filters', async () => {
    await client.query('SAVEPOINT secondary_source');
    try {
      await client.query('UPDATE public.products SET category_id=$1 WHERE id=$2',[ids.catA,ids.prodA]);
      const lines=await runAs(client,ids.users.cashier,
        `SELECT public.get_operational_report_dataset('sales',$1,CURRENT_DATE-60,CURRENT_DATE+1,$2) AS value`,
        [ids.branchA,{product:ids.prodA,category:ids.catA,include_items:'true',settled_only:'true'}]);
      expect(lines.error).toBeUndefined();
      const source=lines.rows[0].value as Page;
      expect(source.rows).toHaveLength(1);
      expect(source.rows[0].id).toBe(ids.saleA);
      expect(source.rows[0].items).toEqual([expect.objectContaining({product_id:ids.prodA,unit_name:'piece',quantity:1})]);
      expect(((source.rows[0].items as Record<string,unknown>[])[0].product as Record<string,unknown>).category_id).toBe(ids.catA);
      const foreign=await runAs(client,ids.users.cashier_b,
        `SELECT public.get_operational_report_dataset('sales',$1,CURRENT_DATE-60,CURRENT_DATE+1,$2) AS value`,
        [ids.branchA,{product:ids.prodA,include_items:'true'}]);
      expect((foreign.rows[0].value as Page).rows).toEqual([]);
      const returns=await page('sales',ids.users.cashier,ids.branchA,0,{cashier:ids.users.cashier,returns_only:'true'});
      expect(returns.summary.count).toBe(205);
      expect(returns.rows.every(row=>row.cashier_id===ids.users.cashier)).toBe(true);
    } finally { await client.query('ROLLBACK TO SAVEPOINT secondary_source'); }
  });

  it('uses shared stock aggregates for balances and low-stock, retaining negative quantities and branch RLS', async () => {
    await client.query('SAVEPOINT stock_source');
    try {
      await client.query(`INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,source_type)
        VALUES($1,$2,$3,-3,10,'opening')`,[ids.rm,ids.branchA,ids.whA]);
      const result=await runAs(client,ids.users.cashier,
        `SELECT public.get_operational_stock_source($1,NULL,false) AS detail,
          public.get_operational_stock_source($1,NULL,true) AS low`,[ids.branchA]);
      expect(result.error).toBeUndefined();
      const detail=result.rows[0].detail as Record<string,Record<string,unknown>[]>;
      const low=result.rows[0].low as Record<string,Record<string,unknown>[]>;
      const direct=await runAs(client,ids.users.cashier,
        'SELECT coalesce(sum(quantity),0)::float AS qty FROM public.raw_material_batches WHERE branch_id=$1',[ids.branchA]);
      expect(detail.rawRows.reduce((sum,row)=>sum+Number(row.quantity),0)).toBe(direct.rows[0].qty);
      expect(low.rawBalances.reduce((sum,row)=>sum+Number(row.quantity),0)).toBe(direct.rows[0].qty);
      expect(detail.rawRows.some(row=>Number(row.quantity)<0)).toBe(true);
      const foreign=await runAs(client,ids.users.cashier_b,
        'SELECT public.get_operational_stock_source($1,NULL,false) AS value',[ids.branchA]);
      expect((foreign.rows[0].value as typeof detail).rawRows).toEqual([]);
      const acl=await client.query(`SELECT prosecdef,has_function_privilege('anon',oid,'EXECUTE') AS anon_execute
        FROM pg_proc WHERE proname='get_operational_stock_source'`);
      expect(acl.rows).toEqual([{prosecdef:false,anon_execute:false}]);
    } finally { await client.query('ROLLBACK TO SAVEPOINT stock_source'); }
  });

});
