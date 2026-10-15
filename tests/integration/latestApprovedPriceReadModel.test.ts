import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
const url=getDbUrl();
const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('latest approved price projection, owned localhost only',()=>{
 let db:pg.Client;
 const a=randomUUID(),b=randomUUID(),w=randomUUID(),raw=randomUUID(),empty=randomUUID(),foreign=randomUUID(),unit=randomUUID(),purchase=randomUUID(),count=randomUUID(),manual=randomUUID(),viewer=randomUUID();
 const time='2026-10-01T12:00:00Z';
 const expectedSql=readFileSync('scripts/rollback/latest_approved_prices_originals_20261016.sql','utf8');
 async function prices(fn='get_raw_material_current_prices',branch:string|null=a,ids:string[]=[raw,empty]){
  return(await db.query(`SELECT raw_material_id,branch_id,unit_cost::numeric(18,6)::text,price_source,priced_at,reference_number FROM public.${fn}($1,$2${fn.includes('kitchen')?',\'infinity\'::timestamptz':''}) ORDER BY raw_material_id`,[branch,ids])).rows;
 }
 async function parity(){const expected=await prices('qa_original_kitchen_price');const actual=await prices('_kitchen_approved_price_candidate');expect(actual).toEqual(expected);return actual;}
 beforeAll(async()=>{
  db=openDb(url!);await db.connect();await db.query('BEGIN');
  // Only the historical reference alias is installed; canonical candidate is active.
  const old=expectedSql.slice(0,expectedSql.indexOf('CREATE OR REPLACE FUNCTION public.get_raw_material_current_prices'));
  await db.query(old.replace('public._kitchen_approved_price_candidate','public.qa_original_kitchen_price'));
  await db.query('GRANT EXECUTE ON FUNCTION public.qa_original_kitchen_price(uuid,uuid[],timestamptz) TO authenticated');
  await db.query('INSERT INTO public.branches(id,name) VALUES($1,\'Price A\'),($2,\'Price B\')',[a,b]);
  await db.query('INSERT INTO public.warehouses(id,name,branch_id) VALUES($1,\'Price warehouse\',$2)',[w,a]);
  await db.query("INSERT INTO public.units(id,code,name,symbol) VALUES($1,$2,'Price gram','g')",[unit,randomUUID()]);
  for(const [id,branch]of[[raw,a],[empty,a],[foreign,b]])await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost) VALUES($1,$2,'Price material',$3,$4,0)",[id,randomUUID(),branch,unit]);
  await db.query("INSERT INTO public.purchases(id,invoice_number,branch_id,subtotal,total,paid_amount,status,created_at,approved_at) VALUES($1,'PRICE-HISTORY',$2,1,1,0,'completed',$3,$3)",[purchase,a,time]);
  // Many purchase price sources, no duplicate FIFO history projection.
  await db.query("INSERT INTO public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total,created_at) SELECT $1,$2,'kg',1,12345.67,12345.67,$3 FROM generate_series(1,1500)",[purchase,raw,time]);
  await db.query("INSERT INTO public.stock_counts(id,branch_id,warehouse_id,status,applied_at,count_number) VALUES($1,$2,$3,'applied',$4,'PRICE-COUNT')",[count,a,w,'2026-10-02T12:00:00Z']);
  await db.query('INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,unit_cost) VALUES($1,$2,15)',[count,raw]);
  await db.query("INSERT INTO public.raw_material_price_events(id,raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,$3,20,'PRICE-MANUAL','2026-10-03T12:00:00Z'),($4,$5,$6,77,'PRICE-FOREIGN','2026-10-03T12:00:00Z')",[manual,raw,a,randomUUID(),foreign,b]);
  await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,batch_number) SELECT $1,$2,$3,-1,8,8,'sale','PRICE-REAL-'||g FROM generate_series(1,3000)g",[raw,a,w]);
  await db.query('ANALYZE private.raw_approved_price_read_model');
 },60000);
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 it('uses latest approved prices in both branches, leaves never-priced stock unknown, and retains exact as-of kitchen prices',async()=>{
  const rows=await prices();expect(rows.find(x=>x.raw_material_id===raw)?.unit_cost).toBe('20.000000');expect(rows.find(x=>x.raw_material_id===empty)).toMatchObject({unit_cost:null,price_source:'unpriced'});
  expect((await prices('get_raw_material_current_prices',b,[foreign]))[0].unit_cost).toBe('77.000000');await parity();
  for(const asof of['2026-10-01T13:00:00Z','2026-10-02T13:00:00Z','2026-10-03T13:00:00Z']){
   const read=async(fn:string)=>(await db.query(`SELECT * FROM public.${fn}($1,$2,$3)`,[a,[raw],asof])).rows;
   expect(await read('_kitchen_approved_price_candidate')).toEqual(await read('qa_original_kitchen_price'));
  }
  expect((await db.query("SELECT count(*)::int n FROM private.raw_approved_price_read_model WHERE raw_material_id=$1 AND source_kind='inventory_ledger'",[raw])).rows[0].n).toBe(0);
 });
 it('updates, deletes, cancels and reapproves source prices transactionally with exact normalization',async()=>{
  await db.query('SAVEPOINT mutations');
  try{
   await db.query('UPDATE public.raw_material_price_events SET unit_cost=21 WHERE id=$1',[manual]);expect((await parity())[0].unit_cost).toBe('21.000000');
   await db.query('DELETE FROM public.raw_material_price_events WHERE id=$1',[manual]);expect((await parity())[0].unit_cost).toBe('15.000000');
   await db.query("UPDATE public.stock_counts SET applied_at='2026-10-06T12:00:00Z',count_number='PRICE-COUNT-UPDATED' WHERE id=$1",[count]);expect((await parity())[0].reference_number).toBe('PRICE-COUNT-UPDATED');
   await db.query("UPDATE public.stock_counts SET status='rejected' WHERE id=$1",[count]);expect((await parity())[0].unit_cost).toBe('12.345670');
   await db.query("UPDATE public.purchases SET status='cancelled' WHERE id=$1",[purchase]);expect(await parity()).toHaveLength(0);
   await db.query("UPDATE public.purchases SET status='completed',approved_at='2026-10-04T12:00:00Z',invoice_number='PRICE-UPDATED' WHERE id=$1",[purchase]);expect((await parity())[0]).toMatchObject({unit_cost:'12.345670',reference_number:'PRICE-UPDATED'});
   await db.query("INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,created_at) VALUES($1,$2,$3,1,31.25,31.25,'purchase','purchase',$4,'2026-10-05T12:00:00Z')",[raw,a,w,purchase]);expect((await parity())[0].unit_cost).toBe('31.250000');
   await db.query("UPDATE public.inventory_ledger SET unit_cost=0 WHERE reference_id=$1 AND entry_type='purchase'",[purchase]);expect(await parity()).toHaveLength(0); // zero ledger still suppresses legacy
   await db.query("DELETE FROM public.inventory_ledger WHERE reference_id=$1 AND entry_type='purchase'",[purchase]);expect((await parity())[0].unit_cost).toBe('12.345670');
  }finally{await db.query('ROLLBACK TO mutations');await db.query('RELEASE mutations');}
  expect((await prices()).find(x=>x.raw_material_id===raw)?.unit_cost).toBe('20.000000');
 });
 it('preserves an undated known purchase price for current displays without inventing a historical dispatch date',async()=>{
  await db.query('SAVEPOINT undated_price');
  try{
   const material=randomUUID(),parent=randomUUID();
   await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost) VALUES($1,$2,'Undated price',$3,$4,0)",[material,randomUUID(),a,unit]);
   await db.query("INSERT INTO public.purchases(id,invoice_number,branch_id,subtotal,total,paid_amount,status,created_at,approved_at) VALUES($1,'UNDATED-PRICE',$2,13.4,13.4,0,'completed',NULL,NULL)",[parent,a]);
   await db.query("INSERT INTO public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total,created_at) VALUES($1,$2,'g',1,13.4,13.4,NULL)",[parent,material]);
   expect((await prices('get_raw_material_current_prices',a,[material]))[0]).toMatchObject({unit_cost:'13.400000',priced_at:null,price_source:'purchase'});
   expect(await prices('_kitchen_approved_price_candidate',a,[material])).toEqual(await prices('qa_original_kitchen_price',a,[material]));
   expect(await prices('_kitchen_approved_price_candidate',a,[material])).toEqual([]);
  }finally{await db.query('ROLLBACK TO undated_price');await db.query('RELEASE undated_price');}
 });
 it('rehearses guarded rollback without changing FIFO or accounting functions',async()=>{
  const fingerprint=async()=>(await db.query("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('_raw_remove_fifo','_deduct_kitchen_raw_components','_send_to_kitchen_core_20260914','claim_cloud_print_jobs','process_sale_idempotent')")).rows[0].hash;
  const before=await fingerprint();
  // Capture only immutable public definitions; rollback is exercised in savepoint.
  await db.query('SAVEPOINT restore_prices');
  try{
   const sql=readFileSync('scripts/rollback/latest_approved_price_read_model_20261016.sql','utf8').replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
   await db.query(sql);
   expect((await db.query("SELECT to_regclass('private.raw_approved_price_read_model') value")).rows[0].value).toBeNull();
   expect((await db.query("SELECT md5(pg_get_functiondef('public.get_raw_material_current_prices(uuid,uuid[])'::regprocedure)) hash")).rows[0].hash).toBe('c883a34810a148b89f8fb3d7069220c2');
  }finally{await db.query('ROLLBACK TO restore_prices');await db.query('RELEASE restore_prices');}
  expect((await prices()).find(x=>x.raw_material_id===raw)?.unit_cost).toBe('20.000000');
  expect(await fingerprint()).toBe(before);
 });
 it('preserves a pre-existing last known price at cutover and never backdates it into old kitchen snapshots',async()=>{
  await db.query('SAVEPOINT cutover');
  const sql=(path:string)=>readFileSync(path,'utf8').replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
  try{
   await db.query(sql('scripts/rollback/latest_approved_price_read_model_20261016.sql'));
   await db.query('UPDATE public.raw_materials SET default_cost=17 WHERE id=$1',[empty]);
   expect((await prices()).find(x=>x.raw_material_id===empty)?.unit_cost).toBe('17.000000');
   const before=(await db.query('SELECT clock_timestamp() t')).rows[0].t;
   await db.query(sql('supabase/migrations/20261015215855_latest_approved_price_read_model.sql'));
   expect((await prices()).find(x=>x.raw_material_id===empty)?.unit_cost).toBe('17.000000');
   expect((await db.query('SELECT * FROM public._kitchen_approved_price_candidate($1,$2,$3)',[a,[empty],before])).rows).toEqual([]);
   expect((await db.query('SELECT * FROM public._kitchen_approved_price_candidate($1,$2,clock_timestamp())',[a,[empty]])).rows[0].unit_cost).toBe('17.000000');
   await db.query('UPDATE public.raw_materials SET default_cost=18 WHERE id=$1',[empty]);
   await db.query(sql('scripts/rollback/latest_approved_price_read_model_20261016.sql'));
   expect((await prices()).find(x=>x.raw_material_id===empty)?.unit_cost).toBe('18.000000'); // genuine new user price retained
   expect((await db.query("SELECT count(*)::int n FROM public.raw_material_price_events WHERE id=md5('latest-approved-start-20261016:'||$1::text)::uuid",[empty])).rows[0].n).toBe(0);
  }finally{await db.query('ROLLBACK TO cutover');await db.query('RELEASE cutover');}
 });
 it('captures manual catalog changes once and avoids duplicating explicit price RPC events',async()=>{
  await db.query('SAVEPOINT catalog_price');
  try{
   await db.query('UPDATE public.raw_materials SET default_cost=23 WHERE id=$1',[empty]);
   expect((await prices()).find(x=>x.raw_material_id===empty)?.unit_cost).toBe('23.000000');
   const count=async()=>Number((await db.query('SELECT count(*) n FROM public.raw_material_price_events WHERE raw_material_id=$1',[empty])).rows[0].n);
   const n=await count();await db.query("UPDATE public.raw_materials SET name='Updated name',default_cost=23 WHERE id=$1",[empty]);expect(await count()).toBe(n);
   // Same transaction insertion matches the existing explicit RPC ordering.
   await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number) VALUES($1,$2,24,'EXPLICIT-PRICE-RPC-ORDER')",[empty,a]);
   await db.query('UPDATE public.raw_materials SET default_cost=24 WHERE id=$1',[empty]);expect(await count()).toBe(n+1);
   expect((await prices()).find(x=>x.raw_material_id===empty)?.unit_cost).toBe('24.000000');await parity();
  }finally{await db.query('ROLLBACK TO catalog_price');await db.query('RELEASE catalog_price');}
 });
 it('bounds price reads without scanning FIFO history and records before/after work',async()=>{
  const explain=async(fn:string)=>(await db.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM public.${fn}($1,$2,'infinity'::timestamptz)`,[a,[raw]])).rows[0]['QUERY PLAN'][0];
  await explain('qa_original_kitchen_price');await explain('_kitchen_approved_price_candidate');
  const before=await explain('qa_original_kitchen_price'),after=await explain('_kitchen_approved_price_candidate');
  const blocks=(p:Record<string,number>)=>p['Shared Hit Blocks']+p['Shared Read Blocks'];
  expect(blocks(after.Plan)).toBeLessThan(blocks(before.Plan));
  const indexed=(await db.query("EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT source_id FROM private.raw_approved_price_read_model WHERE branch_id=$1 AND raw_material_id=$2 ORDER BY priced_at DESC NULLS LAST,source_rank,reference_number DESC NULLS LAST,event_id DESC LIMIT 1",[a,raw])).rows[0]['QUERY PLAN'][0];
  expect(JSON.stringify(indexed)).toContain('raw_approved_price_latest');
  console.info('LATEST_APPROVED_PRICE_PLAN '+JSON.stringify({source:'owned localhost 1500 purchase prices + 3000 FIFO issues; no production latency claim',before,after,indexed}));
 });
 it('does not add FIFO issue WAL and lets independent concurrent prices commit without a last-price row lock',async()=>{
  const issue=async()=>{
   await db.query('SAVEPOINT issue_wal');
   try{return(await db.query("EXPLAIN(ANALYZE,WAL,FORMAT JSON) INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,batch_number) SELECT $1,$2,$3,-1,8,-8,'sale','PRICE-WAL-'||g FROM generate_series(1,64)g",[raw,a,w])).rows[0]['QUERY PLAN'][0].Plan['WAL Bytes'];}
   finally{await db.query('ROLLBACK TO issue_wal');await db.query('RELEASE issue_wal');}
  };
  const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  await db.query('SAVEPOINT no_price_triggers');
  let old:number[]=[];
  try{for(const t of['raw_price_source_insert','raw_price_source_update','raw_price_source_delete'])await db.query('ALTER TABLE public.inventory_ledger DISABLE TRIGGER '+t);await issue();old=[await issue()];for(let i=0;i<4;i++)old.push(await issue());}
  finally{await db.query('ROLLBACK TO no_price_triggers');await db.query('RELEASE no_price_triggers');}
  await issue();const next:number[]=[];for(let i=0;i<5;i++)next.push(await issue());
  expect(median(next)).toBeLessThanOrEqual(median(old)*1.05);
  console.info('LATEST_PRICE_ISSUE_WAL '+JSON.stringify({old,next}));
  const first=openDb(url!),second=openDb(url!),branch=randomUUID(),material=randomUUID(),id1=randomUUID(),id2=randomUUID();
  await first.connect();await second.connect();
  try{
   await first.query("INSERT INTO public.branches(id,name) VALUES($1,'Owned concurrency price fixture')",[branch]);
   await first.query("INSERT INTO public.raw_materials(id,code,name,branch_id) VALUES($1,$2,'Concurrent price',$3)",[material,randomUUID(),branch]);
   await first.query('BEGIN');
   await first.query("INSERT INTO public.raw_material_price_events(id,raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,$3,41,'CONCURRENT-1','2026-10-10T12:00:00Z')",[id1,material,branch]);
   await second.query("SET statement_timeout='2s'");
   await second.query("INSERT INTO public.raw_material_price_events(id,raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,$3,42,'CONCURRENT-2','2026-10-11T12:00:00Z')",[id2,material,branch]);
   await first.query('COMMIT');
   expect(Number((await second.query('SELECT unit_cost FROM public.get_raw_material_current_prices($1,$2)',[branch,[material]])).rows[0].unit_cost)).toBe(42);
  }finally{
   await first.query('ROLLBACK').catch(()=>{});
   await first.query('DELETE FROM public.raw_material_price_events WHERE raw_material_id=$1',[material]);
   await first.query('DELETE FROM public.raw_materials WHERE id=$1',[material]);
   await first.query('DELETE FROM public.branches WHERE id=$1',[branch]);
   await first.end();await second.end();
  }
 });
 it('preserves branch/source visibility and rejects cache writes and maintenance calls by application roles',async()=>{
  await db.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
  await db.query("INSERT INTO public.roles(role,name_ar,name_en,permissions,is_active) VALUES('latest_price_reader','قارئ سعر','Price Reader','[\"raw_materials.view\",\"reports.costing\",\"history.unlimited\"]',true) ON CONFLICT(role) DO UPDATE SET permissions=EXCLUDED.permissions");
  await db.query("INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'Price Viewer','latest_price_reader',$3,true)",[viewer,viewer+'@test.local',a]);
  await db.query("SELECT set_config('app.user_id',$1,true)",[viewer]);await db.query('SET LOCAL ROLE authenticated');
  try{expect(await prices('get_raw_material_current_prices',b,[foreign])).toEqual([]);expect((await prices()).find(x=>x.raw_material_id===raw)?.unit_cost).toBe('20.000000');await parity();}
  finally{await db.query('RESET ROLE');await db.query('RESET app.user_id');}
  await db.query('SAVEPOINT limited_history');
  try{
   await db.query("UPDATE public.roles SET permissions='[\"raw_materials.view\",\"reports.costing\"]'::jsonb WHERE role='latest_price_reader'");
   await db.query('DELETE FROM public.raw_material_price_events WHERE id=$1',[manual]);
   await db.query("UPDATE public.stock_counts SET status='rejected' WHERE id=$1",[count]);
   await db.query("SELECT set_config('app.user_id',$1,true)",[viewer]);await db.query('SET LOCAL ROLE authenticated');
   const original=await parity();
   const current=(await prices()).find(x=>x.raw_material_id===raw);
   expect(current?.unit_cost??null).toBe(original[0]?.unit_cost??null);
   // Nested existing definer must retain explicit purchase history visibility.
   await db.query('RESET ROLE');
   const context=(await db.query('SELECT public._raw_cost_context_for_costing($1,$2) value',[raw,a])).rows[0].value;
   expect(Number(context.unit_cost)).toBe(Number(original[0]?.unit_cost??0));
  }finally{await db.query('ROLLBACK TO limited_history');await db.query('RELEASE limited_history');await db.query('RESET ROLE');await db.query('RESET app.user_id');}
  const privileges=(await db.query("SELECT has_table_privilege('authenticated','private.raw_approved_price_read_model','INSERT') writes,has_function_privilege('authenticated','private.sync_raw_approved_price_source()','EXECUTE') maintenance,has_table_privilege('anon','private.raw_approved_price_read_model','SELECT') anon")).rows[0];expect(privileges).toEqual({writes:false,maintenance:false,anon:false});
 });
});
