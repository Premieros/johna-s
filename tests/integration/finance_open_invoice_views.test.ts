import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';
const url=getDbUrl();
const owned=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!owned)('outstanding invoice security-invoker views', () => {
 let c:pg.Client; let ids:RlsIds; let impersonation=false;
 beforeAll(async()=>{
  c=openDb(url!); await c.connect(); await c.query('BEGIN'); ids=await seedRlsFixture(c); impersonation=await canImpersonate(c);
  await c.query(`UPDATE public.roles SET permissions=permissions || '["sales.view","purchases.view","history.unlimited"]'::jsonb WHERE role='branch_manager'`);
  await c.query('UPDATE public.sales SET total=100,paid_amount=30,refunded_amount=10 WHERE id=ANY($1::uuid[])',[[ids.saleA,ids.saleB]]);
  await c.query('UPDATE public.purchases SET total=100,paid_amount=0,returned_amount=10 WHERE id=ANY($1::uuid[])',[[ids.purchA,ids.purchB]]);
 });
 afterAll(async()=>{if(c){await c.query('ROLLBACK').catch(()=>{});await c.end();}});
 it('preserves base RLS and returns only positive net outstanding balances',async ctx=>{
  if(!impersonation)return ctx.skip();
  for(const [view,table,a,b] of [['finance_open_receivable_invoices','sales',ids.saleA,ids.saleB],['finance_open_payable_invoices','purchases',ids.purchA,ids.purchB]]){
   const base=await runAs(c,ids.users.branch_manager,`SELECT id FROM public.${table} WHERE id=ANY($1::uuid[]) ORDER BY id`,[[a,b]]);
   const rows=await runAs(c,ids.users.branch_manager,`SELECT id,open FROM public.${view} WHERE id=ANY($1::uuid[]) ORDER BY id`,[[a,b]]);
   expect(rows.error).toBeUndefined(); expect(base.error).toBeUndefined();
   expect(rows.rows.map(r=>r.id)).toEqual(base.rows.map(r=>r.id)); expect(rows.rows.length).toBeGreaterThan(0);
   expect(rows.rows.every(r=>Number(r.open)===(table==='sales'?60:90))).toBe(true);
   await c.query(`UPDATE public.${table} SET ${table==='sales'?'refunded_amount':'returned_amount'}=total-paid_amount WHERE id=$1`,[a]);
   const closed=await runAs(c,ids.users.branch_manager,`SELECT id FROM public.${view} WHERE id=$1`,[a]); expect(closed.rows).toEqual([]);
  }
 });
 it('uses caller privileges and grants no invoice writer or anonymous access',async()=>{
  const r=await c.query(`SELECT reloptions FROM pg_class WHERE oid IN ('public.finance_open_receivable_invoices'::regclass,'public.finance_open_payable_invoices'::regclass)`);
  expect(r.rows.every(r=>r.reloptions.includes('security_invoker=true'))).toBe(true);
  for(const v of ['finance_open_receivable_invoices','finance_open_payable_invoices']){
   const p=await c.query(`SELECT has_table_privilege('anon',$1,'SELECT') a,has_table_privilege('authenticated',$1,'UPDATE') w`,['public.'+v]);
   expect(p.rows[0]).toEqual({a:false,w:false});
  }
 });
});
