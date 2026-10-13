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
  const supplier=randomUUID(),unit=randomUUID(),sourceWh=randomUUID();
  let originalDefinitions:unknown[];
  const catalogSQL=`SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proconfig,p.proacl::text acl,pg_get_userbyid(p.proowner) owner FROM pg_proc p WHERE p.oid IN ('public._capture_kitchen_ingredient_prices()'::regprocedure,'public._raw_fifo_settle_receipt(bigint,uuid,uuid)'::regprocedure,'public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure,'public.apply_stock_count(uuid)'::regprocedure) ORDER BY p.proname`;
  const forward=()=>readFileSync('scripts/rollout/kitchen_dedup_forward_review_20261013.sql','utf8');
  const rollback=()=>readFileSync('scripts/rollout/kitchen_dedup_rollback_review_20261013.sql','utf8');

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
    originalDefinitions=(await observer.query(catalogSQL)).rows;
    await observer.query("SET app.kitchen_rollout_ack='johnas-kitchen-20261013-review-required'");
    await observer.query(forward());
    await observer.query('BEGIN');
    await observer.query("INSERT INTO public.organizations(id,name,slug) VALUES($1,'Committed QA',$2)",[org,'committed-'+org]);
    await observer.query("INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Committed QA',$2)",[branch,org]);
    await observer.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Committed QA',$2,true,true)",[wh,branch]);
    await observer.query("INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES($1,'جرد','QA Counter','[\"inventory.count.create\",\"inventory.count.approve\",\"inventory.count.apply\",\"purchases.manage\",\"inventory.transfer.create\",\"inventory.transfer.approve\",\"pos.void\"]'::jsonb,'global',true)",[role]);
    await observer.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await observer.query("INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$3,'QA Cashier','cashier',$5,true),($2,$4,'QA Counter',$6,$5,true)",[cashier,counter,cashier+'@test.local',counter+'@test.local',branch,role]);
    await observer.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
    await observer.query("INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active) VALUES($1,$2,'member',true),($1,$3,'member',true)",[org,cashier,counter]);
    await observer.query("INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status) VALUES($1,$2,0,'open')",[branch,cashier]);
    await observer.query("INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,'Committed product',$2,10,7,true)",[product,branch]);
    await observer.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$3,'Committed raw',$5,7,true),($2,$4,'Independent raw',$5,7,true)",[raw,otherRaw,'COM-'+raw,'COM-'+otherRaw,branch]);
    await observer.query("INSERT INTO public.units(id,code,name,symbol,is_active) VALUES($1,$2,'Piece','piece',true)",[unit,'PCS-'+unit]);
    await observer.query('UPDATE public.raw_materials SET unit_id=$2 WHERE id=$1',[raw,unit]);
    await observer.query("INSERT INTO public.suppliers(id,name,branch_id,balance) VALUES($1,'Committed supplier',$2,0)",[supplier,branch]);
    await observer.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Transfer source',$2,true,false)",[sourceWh,branch]);
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

  it('fails closed on drift and restores exact original code and ACL before reactivation',async()=>{
    const before=await quantity();
    const bound=(await observer.query(catalogSQL)).rows;
    await observer.query("SET app.kitchen_rollout_ack='missing'");
    await expect(observer.query(rollback())).rejects.toThrow('KITCHEN_ROLLOUT_NOT_ACKNOWLEDGED');
    await observer.query('ROLLBACK');
    expect((await observer.query(catalogSQL)).rows).toEqual(bound);
    await observer.query("SET app.kitchen_rollout_ack='johnas-kitchen-20261013-review-required'");
    await observer.query(rollback());
    expect((await observer.query(catalogSQL)).rows).toEqual(originalDefinitions);
    expect(await quantity()).toBe(before);
    expect((await observer.query("SELECT to_regprocedure('public._kitchen_dispatch_component_plans(uuid,jsonb)') helper")).rows[0].helper).toBeNull();
    // Drift must be rejected atomically before any private helper is installed.
    await observer.query('ALTER FUNCTION public.apply_stock_count(uuid) SET search_path TO public');
    await expect(observer.query(forward())).rejects.toThrow('KITCHEN_CANONICAL_DRIFT');
    await observer.query('ROLLBACK');
    expect((await observer.query("SELECT to_regprocedure('public._kitchen_dispatch_component_plans(uuid,jsonb)') helper")).rows[0].helper).toBeNull();
    await observer.query("ALTER FUNCTION public.apply_stock_count(uuid) SET search_path TO public,pg_temp");
    expect((await observer.query(catalogSQL)).rows).toEqual(originalDefinitions);
    await observer.query(forward());
    expect((await observer.query(catalogSQL)).rows).toEqual(bound);
    expect(await quantity()).toBe(before);
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
  async function assertOfficial(){
    const row=(await observer.query('SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2',[raw,branch])).rows[0];
    const net=(await observer.query('SELECT COALESCE(sum(quantity),0) q FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2',[raw,branch])).rows[0];
    expect(Number(row.quantity)).toBe(Number(net.q));
  }
  it('serializes a committed raw purchase after a kitchen send and keeps the purchase journal balanced',async()=>{
    const id=await order(5,5),before=await quantity();
    await beginActor(a,cashier);await beginActor(b,counter);
    try{
      expect((await a.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier])).rows[0].r.success).toBe(true);
      const invoice='CON-PUR-'+randomUUID();
      const items=JSON.stringify([{raw_material_id:raw,unit_name:'piece',quantity:20,unit_cost:7}]);
      const settled=b.query("SELECT public.process_purchase($1,$2,$3,$4,140,0,0,140,0,'credit','completed',NULL,$5::jsonb) r",[invoice,supplier,branch,wh,items]).then(result=>({result}),error=>({error}));
      await waitForBlock();await a.query('COMMIT');
      const received=await settled;if('error'in received)throw received.error;
      expect(received.result.rows[0].r.success,JSON.stringify(received.result.rows[0].r)).toBe(true);
      await b.query('COMMIT');
      expect(await quantity()).toBe(before-10+20);await assertOfficial();
      const pid=received.result.rows[0].r.purchase_id;
      expect((await observer.query('SELECT count(*)::int n FROM public.purchase_items WHERE purchase_id=$1 AND raw_material_id=$2',[pid,raw])).rows[0].n).toBe(1);
      const journal=(await observer.query("SELECT count(DISTINCT j.id)::int n,sum(l.debit) dr,sum(l.credit) cr FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.reference_type='purchase' AND j.reference_id=$1",[pid])).rows[0];
      expect(journal.n).toBe(1);expect(Number(journal.dr)).toBe(140);expect(Number(journal.cr)).toBe(140);
      expect(Number((await observer.query('SELECT sum(debt_quantity-settled_quantity) q FROM public.raw_fifo_debts WHERE raw_material_id=$1 AND warehouse_id=$2',[raw,wh])).rows[0].q)).toBe(0);
    }finally{await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});}
  },30000);

  it('serializes transfer replenishment after a send and moves stock only once',async()=>{
    await observer.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$2,$3,$4,20,7,'opening')",[raw,branch,sourceWh,'CON-SRC-'+randomUUID()]);
    const created=await actor(b,counter,async()=>(await b.query('SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) r',[sourceWh,wh,branch,JSON.stringify([{item_type:'raw_material',item_id:raw,destination_item_id:raw,quantity:4,unit_cost:7}])])).rows[0].r);
    expect(created.success,JSON.stringify(created)).toBe(true);
    const id=await order(2,3),before=await quantity();
    await beginActor(a,cashier);await beginActor(b,counter);
    try{
      expect((await a.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier])).rows[0].r.success).toBe(true);
      const pending=b.query('SELECT public.approve_warehouse_transfer($1) r',[created.transfer_id]).then(result=>({result}),error=>({error}));
      await waitForBlock();await a.query('COMMIT');
      const moved=await pending;if('error'in moved)throw moved.error;
      expect(moved.result.rows[0].r.success,JSON.stringify(moved.result.rows[0].r)).toBe(true);await b.query('COMMIT');
      expect(await quantity()).toBe(before-5+4);
      expect(Number((await observer.query('SELECT sum(quantity) q FROM public.raw_material_batches WHERE raw_material_id=$1 AND warehouse_id=$2',[raw,sourceWh])).rows[0].q)).toBe(16);
      await assertOfficial();
      const retry=await actor(b,counter,async()=>(await b.query('SELECT public.approve_warehouse_transfer($1) r',[created.transfer_id])).rows[0].r);
      expect(retry).toMatchObject({success:false,error:'INVALID_STATUS'});expect(await quantity()).toBe(before-1);
    }finally{await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});}
  },30000);

  it('serializes an authorized partial void with a same-order resend without rededucting',async()=>{
    const id=await order(2,3),before=await quantity();
    await actor(a,cashier,async()=>{expect((await a.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier])).rows[0].r.success).toBe(true);});
    const item=(await observer.query('SELECT id FROM public.order_items WHERE order_id=$1 ORDER BY quantity LIMIT 1',[id])).rows[0].id;
    await beginActor(a,counter);await beginActor(b,cashier);
    try{
      const cancelled=(await a.query("SELECT public.cancel_sent_order_item_exact($1,$2,1,'concurrent void') r",[id,item])).rows[0].r;
      expect(cancelled.success,JSON.stringify(cancelled)).toBe(true);
      const pending=b.query('SELECT public.send_to_kitchen($1,$2) r',[id,cashier]).then(result=>({result}),error=>({error}));
      await waitForBlock();await a.query('COMMIT');
      const resent=await pending;if('error'in resent)throw resent.error;
      expect(resent.result.rows[0].r).toMatchObject({success:true,items_sent_count:0});await b.query('COMMIT');
      expect(await quantity()).toBe(before-4);await assertOfficial();
      expect((await observer.query('SELECT count(*)::int n FROM public.order_kitchen_voids WHERE order_id=$1',[id])).rows[0].n).toBe(1);
      expect((await observer.query('SELECT sum(sent_quantity)::numeric q FROM public.order_kitchen_sends WHERE order_id=$1',[id])).rows[0].q).toBe('4');
    }finally{await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});}
  },30000);

});
