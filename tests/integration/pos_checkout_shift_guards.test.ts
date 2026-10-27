import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl=getDbUrl();
describe.skipIf(!dbUrl)('checkout explicit shift guard and rollback',()=>{
 let client:pg.Client; let ids:RlsIds;
 beforeAll(async()=>{client=openDb(dbUrl!);await client.connect();await client.query('BEGIN');ids=await seedRlsFixture(client);});
 afterAll(async()=>{if(client){await client.query('ROLLBACK');await client.end();}});
 for(const role of ['owner','branch_manager','cashier'] as const) {
  for(const split of [false,true]) {
   it(`${role} cannot attach ${split?'split':'normal'} checkout to a closed or foreign shift`,async()=>{
    await client.query("UPDATE public.roles SET permissions=permissions || '[\"pos.payment.take\",\"shifts.manage\"]'::jsonb WHERE role=$1",[role]);
    const invoke=async(shift:string)=>{
     const method=split?'process_sale_split':'process_sale';
     const paid=split?"'[{\"payment_method\":\"cash\",\"amount\":1},{\"payment_method\":\"card\",\"amount\":1}]'::jsonb":"2";
     const sql=`SELECT public.${method}('SHIFT-GUARD',$1,$2,NULL,NULL,2,0,'amount',0,0,2,${paid},'completed','[]'::jsonb,$3,'takeaway',NULL,NULL,NULL) r`;
     const result=await runAsPersist(client,ids.users[role],sql,[ids.branchA,ids.whA,shift]);
     expect(result.error).toBeUndefined();
     expect(result.rows[0].r).toMatchObject({success:false,error:'NO_OPEN_SHIFT'});
    };
    await client.query("UPDATE public.shifts SET status='closed' WHERE id=$1",[ids.shiftA]);
    await invoke(ids.shiftA);
    await client.query("UPDATE public.shifts SET status='open' WHERE id=$1",[ids.shiftA]);
    await invoke(ids.shiftB);
    const rows=await client.query("SELECT count(*)::int n FROM public.sales WHERE invoice_number='SHIFT-GUARD'");
    expect(rows.rows[0].n).toBe(0);
   });
  }
 }
 it('reverses only the two function edits and reapplies with identical security metadata',async()=>{
  const read=()=>client.query("SELECT p.proname,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proowner,p.proacl,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND ((p.proname='process_sale' AND p.pronargs=20) OR (p.proname='process_sale_split' AND p.pronargs=19)) ORDER BY p.proname");
  const before=(await read()).rows;
  expect(before).toHaveLength(2);
  await client.query('SAVEPOINT checkout_rollback');
  try {
   await client.query(readFileSync('scripts/rollback/pos_checkout_concurrency_safety_20261027.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
   const reverted=(await read()).rows;
   expect(reverted.every(row=>!row.definition.includes('POS_CHECKOUT_OWNER_LOCK'))).toBe(true);
   const migration=readdirSync('supabase/migrations').find(f=>f.endsWith('_pos_checkout_concurrency_safety.sql'))!;
   await client.query(readFileSync(`supabase/migrations/${migration}`,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
   expect((await read()).rows).toEqual(before);
  } finally {await client.query('ROLLBACK TO SAVEPOINT checkout_rollback');}
 });
});
