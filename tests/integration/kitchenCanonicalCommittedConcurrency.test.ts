import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';

const originalUrl=getDbUrl();
let enabled=false;
try {
  const u=new URL(originalUrl);
  enabled=process.env.GITHUB_ACTIONS==='true'&&process.env.CI==='true'
    &&['localhost','127.0.0.1','[::1]'].includes(u.hostname);
} catch { /* disposable GitHub CI service only */ }

// Real COMMIT tests own a NEW throwaway database. Never commit in the shared
// integration fixture database, and never connect to a production host.
describe.skipIf(!enabled)('committed public kitchen binding concurrency in an owned CI database',()=>{
  let control:pg.Client,a:pg.Client,b:pg.Client,observer:pg.Client;
  const database='qa_kitchen_'+randomUUID().replace(/-/g,'');
  let createdDatabase=false;
  const branch=randomUUID(),org=randomUUID(),wh=randomUUID(),raw=randomUUID(),otherRaw=randomUUID();
  const product=randomUUID(),cashier=randomUUID(),counter=randomUUID(),role='qa_counter_'+randomUUID().slice(0,8);
  let pidA:number,pidB:number;

  async function beginActor(db:pg.Client,user:string){
    await db.query('BEGIN');await db.query("SELECT set_config('app.user_id',$1,true)",[user]);
    await db.query('SET LOCAL ROLE authenticated');
  }
  async function actor<T>(db:pg.Client,user:string,fn:()=>Promise<T>){
    await beginActor(db,user);
    try {const result=await fn();await db.query('COMMIT');return result;}
    catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  }
  async function order(q1:number,q2:number){
    const table=randomUUID();
    await observer.query("INSERT INTO public.dining_tables(id,name,branch_id,capacity,status) VALUES($1,$2,$3,4,'vacant')",[table,'CON-'+table,branch]);
    const items=JSON.stringify([q1,q2].map((quantity,index)=>({product_id:product,unit_name:'piece',quantity,unit_price:10,discount_amount:0,bonus_quantity:0,total:quantity*10,notes:'concurrent '+index,modifier_option_ids:[]})));
    const r=await actor(a,cashier,async()=>(await a.query("SELECT public.create_order($1,'dine_in',$2,NULL,2,NULL,$3::jsonb,$4,0,'amount',0,$4,$5) r",[branch,table,items,(q1+q2)*10,cashier])).rows[0].r);
    expect(r.success,JSON.stringify(r)).toBe(true);
    await observer.query('UPDATE public.orders SET inventory_warehouse_id=$2 WHERE id=$1',[r.order_id,wh]);
    return r.order_id as string;
  }
  async function waitForBlock(){
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      const row=(await observer.query("SELECT wait_event_type,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1",[pidB])).rows[0];
      if(row?.wait_event_type==='Lock'&&row.blockers.includes(pidA))return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('Second transaction did not wait behind the expected first writer');
  }
  async function quantity(){return Number((await observer.query('SELECT COALESCE(sum(quantity),0) q FROM public.raw_material_batches WHERE raw_material_id=$1 AND warehouse_id=$2',[raw,wh])).rows[0].q);}
  beforeAll(async()=>{
    if(!/^qa_kitchen_[a-f0-9]{32}$/.test(database))throw new Error('Invalid owned database name');
    control=openDb(originalUrl);await control.connect();
    await control.query('CREATE DATABASE "'+database+'"');createdDatabase=true;
    const url=new URL(originalUrl);url.pathname='/'+database;
    const dbUrl=url.toString();
    const run=(args:string[])=>execFileSync(process.execPath,['scripts/db/apply-migration.js',...args],{
      env:{...process.env,SUPABASE_DB_URL:dbUrl},encoding:'utf8',maxBuffer:20*1024*1024,
    });
    run(['--file','supabase/ci/stub_auth.sql']);run(['--dir','supabase/migrations']);
    for(const path of ['supabase/ci/disable_subscription_guard.sql','supabase/ci/seed_raw_material_branch.sql','supabase/ci/permission_first_role_fixture.sql'])run(['--file',path]);
    a=openDb(dbUrl);b=openDb(dbUrl);observer=openDb(dbUrl);
    await a.connect();await b.connect();await observer.connect();
    pidA=(await a.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    pidB=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await observer.query('BEGIN');
    for(const path of [
      'kitchen_component_reuse_dispatch_candidate_20261012.sql',
      'kitchen_component_price_reuse_dispatch_candidate_20261012.sql',
      'kitchen_negative_reuse_dispatch_candidate_20261013.sql',
      'kitchen_stock_count_material_lock_candidate_20261012.sql',
      'raw_fifo_receipt_reuse_candidate_20261013.sql',
      'kitchen_canonical_binding_rehearsal_20261013.sql',
    ])await observer.query(readFileSync('scripts/experiments/'+path,'utf8'));
    await observer.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'Committed QA',$2)",[org,'committed-'+org]);
    await observer.query("INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Committed QA',$2)",[branch,org]);
    await observer.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Committed QA',$2,true,true)",[wh,branch]);
    await observer.query("INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES($1,'جرد','QA Counter','[\"inventory.count.create\",\"inventory.count.approve\",\"inventory.count.apply\"]'::jsonb,'global',true)",[role]);
    await observer.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await observer.query("INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$3,'QA Cashier','cashier',$5,true),($2,$4,'QA Counter',$6,$5,true)",[cashier,counter,cashier+'@test.local',counter+'@test.local',branch,role]);
    await observer.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
    await observer.query("INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active) VALUES($1,$2,'member',true),($1,$3,'member',true)",[org,cashier,counter]);
    await observer.query("INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status) VALUES($1,$2,0,'open')",[branch,cashier]);
    await observer.query("INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,'Committed product',$2,10,7,true)",[product,branch]);
    await observer.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$3,'Committed raw',$5,7,true),($2,$4,'Independent raw',$5,7,true)",[raw,otherRaw,'COM-'+raw,'COM-'+otherRaw,branch]);
    const recipe=randomUUID();
    await observer.query("INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active) VALUES($1,$2,$3,'Committed recipe',1,true)",[recipe,product,branch]);
    await observer.query('INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,1,0)',[recipe,raw]);
    await observer.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,7,'pricing','COMMIT-PRICE',now()-interval '1 day')",[raw,branch]);
    await observer.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$2,$3,'COMMIT-ZERO',0,7,'opening')",[raw,branch,wh]);
    await observer.query('INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,0,7)',[raw,branch]);
    await observer.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);await observer.query('SELECT public.seed_account_mappings($1)',[branch]);
    await observer.query('UPDATE public.settings SET tax_enabled=false');
    await observer.query('COMMIT');
  },120000);
  afterAll(async()=>{
    for(const db of [a,b,observer])if(db){await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
    if(control){
      if(createdDatabase)await control.query('DROP DATABASE "'+database+'" WITH (FORCE)');
      await control.end();
    }
  },30000);

  it('commits concurrent sends for the SAME order without duplicate deductions or sends',async()=>{
    const id=await order(2,3);
    await beginActor(a,cashier);await beginActor(b,cashier);
    try {
      const first=(await a.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier])).rows[0].r;
      expect(first.success,JSON.stringify(first)).toBe(true);expect(first.items_sent_count).toBe(2);
      const pending=b.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier]);
      // Attach a rejection observer immediately; do not leave an unhandled async query.
      const settled=pending.then(result=>({result}),error=>({error}));
      await waitForBlock();
      await a.query('COMMIT');
      const second=await settled;
      if('error' in second)throw second.error;
      expect(second.result.rows[0].r).toMatchObject({success:true,items_sent_count:0});
      await b.query('COMMIT');
      expect(await quantity()).toBe(-5);
      expect((await observer.query('SELECT count(*)::int n FROM public.order_kitchen_sends WHERE order_id=$1',[id])).rows[0].n).toBe(2);
      expect((await observer.query('SELECT count(*)::int n FROM public.order_kitchen_inventory_events WHERE order_id=$1',[id])).rows[0].n).toBe(2);
      expect(Number((await observer.query('SELECT sum(debt_quantity) q FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw])).rows[0].q)).toBe(5);
    } finally {await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});}
  },30000);

  it('counts the physical quantity from the newly COMMITTED negative send and preserves frozen prices',async()=>{
    const id=await order(1,3);
    const count=await actor(b,counter,async()=>(await b.query("SELECT public.create_stock_count($1,$2,'cycle','committed QA',$3::jsonb) r",[branch,wh,JSON.stringify([{raw_material_id:raw,counted_quantity:2,unit_cost:7,reason:'physical'}])])).rows[0].r);
    expect(count.success,JSON.stringify(count)).toBe(true);
    await observer.query("UPDATE public.stock_counts SET status='approved' WHERE id=$1",[count.stock_count_id]);
    const frozen=(await observer.query('SELECT id,component_snapshot FROM public.order_kitchen_inventory_events WHERE branch_id=$1 ORDER BY id',[branch])).rows;
    await beginActor(a,cashier);await beginActor(b,counter);
    try {
      const sent=(await a.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier])).rows[0].r;
      expect(sent.success,JSON.stringify(sent)).toBe(true);
      const settled=b.query('SELECT public.apply_stock_count($1) r',[count.stock_count_id]).then(result=>({result}),error=>({error}));
      await waitForBlock();
      await observer.query('BEGIN');
      expect((await observer.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0)) allowed",[otherRaw,branch])).rows[0].allowed).toBe(true);
      await observer.query('ROLLBACK');
      await a.query('COMMIT');
      const applied=await settled;if('error' in applied)throw applied.error;
      expect(applied.result.rows[0].r,JSON.stringify(applied.result.rows[0].r)).toMatchObject({success:true,items_applied:1});
      await b.query('COMMIT');
      expect(await quantity()).toBe(2);
      expect(Number((await observer.query('SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2',[raw,branch])).rows[0].quantity)).toBe(2);
      const debt=(await observer.query('SELECT sum(debt_quantity) q,sum(settled_quantity) settled FROM public.raw_fifo_debts WHERE raw_material_id=$1',[raw])).rows[0];
      expect(Number(debt.q)).toBe(9);expect(Number(debt.settled)).toBe(9);
      expect((await observer.query('SELECT id,component_snapshot FROM public.order_kitchen_inventory_events WHERE id=ANY($1::uuid[]) ORDER BY id',[frozen.map(x=>x.id)])).rows).toEqual(frozen);
      const totals=(await observer.query("SELECT count(DISTINCT je.id)::int n,sum(jl.debit) debit,sum(jl.credit) credit FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id WHERE je.reference_type='stock_count' AND je.reference_id=$1",[count.stock_count_id])).rows[0];
      expect(totals.n).toBe(1);expect(Number(totals.debit)).toBe(Number(totals.credit));
      const retry=await actor(b,counter,async()=>(await b.query('SELECT public.apply_stock_count($1) r',[count.stock_count_id])).rows[0].r);
      expect(retry).toMatchObject({success:false,error:'COUNT_NOT_APPROVED'});expect(await quantity()).toBe(2);
    } finally {await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});}
  },30000);
});
