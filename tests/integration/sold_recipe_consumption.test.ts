import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
import { runAs,seedRlsFixture,type RlsIds } from './rls';
import type { ConsumptionLatestResult } from '../../src/api/domains/reporting';
const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('sold current-recipe consumption — owned localhost',()=>{
 let db:pg.Client;let ids:RlsIds;
 const raw=randomUUID(),missing=randomUUID(),recipe=randomUUID(),parent=randomUUID(),child=randomUUID();
 const prefix='SRC-'+randomUUID().slice(0,8);
 beforeAll(async()=>{
  db=openDb(url!);await db.connect();await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='8s'");
  ids=await seedRlsFixture(db);
  await db.query(`UPDATE public.roles SET permissions=permissions || '["reports.view","reports.costing","history.unlimited"]'::jsonb WHERE role='branch_manager'`);
  await db.query(`UPDATE public.products SET name=$1 WHERE id=$2`,[prefix+' product',ids.prodA]);
  await db.query(`INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost) VALUES($1,$2,$3,$4,0),($5,$6,$7,$4,0)`,[raw,randomUUID(),prefix+' meat',ids.branchA,missing,randomUUID(),prefix+' salt']);
  await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at) VALUES($1,$2,350,'INITIAL',now())`,[raw,ids.branchA]);
  await db.query('DELETE FROM public.recipes WHERE product_id=$1',[ids.prodA]);
  await db.query(`INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active) VALUES($1,$2,$3,$4,2,true)`,[recipe,ids.prodA,ids.branchA,prefix]);
  await db.query(`INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,0.3,10),($1,$3,0.2,0)`,[recipe,raw,missing]);
  await db.query(`INSERT INTO public.inventory_units(id,code,name,branch_id,unit_type,is_active) VALUES($1,$2,$3,$4,'manufactured',true),($5,$6,$7,$4,'manufactured',true)`,[parent,randomUUID(),prefix+' parent',ids.branchA,child,randomUUID(),prefix+' child']);
  await db.query('INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,2)',[ids.prodA,parent]);
  await db.query('INSERT INTO public.inventory_unit_recipe_units(unit_id,component_unit_id,quantity,wastage_percent) VALUES($1,$2,0.5,10)',[parent,child]);
  await db.query('INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,0.1,20)',[child,raw]);
  await db.query("DELETE FROM public.product_units WHERE product_id=$1",[ids.prodA]);
  await db.query("INSERT INTO public.product_units(product_id,unit_name,conversion_factor,is_base) VALUES($1,'piece',1,true),($1,'box',2,false)",[ids.prodA]);
  await db.query("UPDATE public.sale_items SET unit_name='box',quantity=4,refunded_quantity=1 WHERE sale_id=$1 AND product_id=$2",[ids.saleA,ids.prodA]);
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 async function report(group='material',page=0,size=100,user=ids.users.branch_manager,branch:string|null=ids.branchA) {
  return runAs(db,user,'SELECT get_sold_recipe_consumption_report($1,CURRENT_DATE-1,CURRENT_DATE+1,$2,$3,$4,$5) r',[branch,group,prefix,page,size]);
 }
 const value=(r:Awaited<ReturnType<typeof report>>)=>{expect(r.error).toBeUndefined();return r.rows[0].r as ConsumptionLatestResult;};
 it('uses net sold units and canonical current composition rather than historical inventory quantities',async()=>{
  const result=value(await report());const meat=result.rows.find(r=>r.raw_material_id===raw)!;
  expect(meat).toMatchObject({net_quantity:1.782,unit_price:350,consumption_value:623.7});
  expect(result.summary).toMatchObject({count:2,total:623.7,unpriced_count:1,missing_recipe_count:0,invalid_unit_count:0,complete:false});
  expect(result.rows.find(r=>r.raw_material_id===missing)).toMatchObject({unit_price:0,consumption_value:0,price_missing:true});
  const canonical=await db.query('SELECT raw_material_id,SUM(quantity*(1+wastage_percent/100)) quantity FROM public._costing_product_raw_lines($1,$2) GROUP BY raw_material_id',[ids.prodA,ids.branchA]);
  for(const line of canonical.rows) expect(result.rows.find(r=>r.raw_material_id===line.raw_material_id)?.net_quantity).toBeCloseTo(Number(line.quantity)*6,9);
 });
 it('keeps product/material totals, full-page exports and search consistent',async()=>{
  const material=value(await report());const product=value(await report('product'));
  expect(product.summary).toEqual(material.summary);expect(product.rows[0].product_sold_quantity).toBe(6);
  const page=value(await report('material',1,1));expect(page.rows).toHaveLength(1);expect(page.summary).toEqual(material.summary);
  expect(value(await report('material',0,5000)).rows).toEqual(material.rows);
 });
 it('reports changed current recipes on the next extraction without changing original movements',async()=>{
  await db.query('SAVEPOINT recipe_change');
  try{
   await db.query('UPDATE public.recipe_items SET quantity=0.6 WHERE recipe_id=$1 AND raw_material_id=$2',[recipe,raw]);
   expect(value(await report()).summary.total).toBe(970.2);
   await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,batch_number) VALUES($1,$2,$3,-750,350,-262500,'sale','sale',$4,$5)`,[raw,ids.branchA,ids.whA,ids.saleA,randomUUID()]);
   expect(value(await report()).summary.total).toBe(970.2);
  }finally{await db.query('ROLLBACK TO SAVEPOINT recipe_change');}
 });
 it('marks missing/cyclic recipes and invalid units as incomplete rather than a complete zero',async()=>{
  await db.query('SAVEPOINT incomplete');
  try{
   await db.query("UPDATE public.sale_items SET unit_name='unknown-unit' WHERE sale_id=$1",[ids.saleA]);
   expect(value(await report()).summary).toMatchObject({invalid_unit_count:1,complete:false});
   await db.query("UPDATE public.sale_items SET unit_name='box' WHERE sale_id=$1",[ids.saleA]);
   await db.query('INSERT INTO public.inventory_unit_recipe_units(unit_id,component_unit_id,quantity,wastage_percent) VALUES($1,$2,1,0)',[child,parent]);
   expect(value(await report()).summary).toMatchObject({missing_recipe_count:1,complete:false});
   await db.query('DELETE FROM public.product_unit_links WHERE product_id=$1',[ids.prodA]);await db.query('UPDATE public.recipes SET is_active=false WHERE id=$1',[recipe]);
   const result=value(await report());expect(result.summary).toMatchObject({count:0,missing_recipe_count:1,complete:false});expect(result.recipe_issues?.[0].product_name).toBe(prefix+' product');
  }finally{await db.query('ROLLBACK TO SAVEPOINT incomplete');}
 });
 it('honors caller RLS on sales, raw materials and prices without granting the private composition helper',async()=>{
  await db.query('SAVEPOINT rls_recipe');
  try{
   await db.query(`CREATE POLICY qa_sold_recipe_hidden_sales ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated USING(id<>'${ids.saleA}'::uuid)`);
   expect(value(await report()).summary.count).toBe(0);await db.query('DROP POLICY qa_sold_recipe_hidden_sales ON public.sales');
   await db.query(`CREATE POLICY qa_sold_recipe_hidden_raw ON public.raw_materials AS RESTRICTIVE FOR SELECT TO authenticated USING(id<>'${raw}'::uuid)`);
   const hidden=value(await report());expect(hidden.rows.some(r=>r.raw_material_id===raw)).toBe(false);expect(hidden.summary.complete).toBe(false);
   await db.query('DROP POLICY qa_sold_recipe_hidden_raw ON public.raw_materials');
   await db.query(`CREATE POLICY qa_sold_recipe_hidden_price ON private.raw_approved_price_read_model AS RESTRICTIVE FOR SELECT TO authenticated USING(raw_material_id<>'${raw}'::uuid)`);
   expect(value(await report()).rows.find(r=>r.raw_material_id===raw)).toMatchObject({price_missing:true,unit_price:0});
  }finally{await db.query('ROLLBACK TO SAVEPOINT rls_recipe');}
  expect((await db.query("SELECT has_function_privilege('authenticated','public._costing_product_raw_lines(uuid,uuid)','execute') allowed")).rows[0].allowed).toBe(false);
  expect((await report('material',0,100,ids.users.cashier)).error).toContain('PERMISSION_DENIED');
  expect((await report('material',0,100,ids.users.branch_manager,ids.branchB)).error).toBe('BRANCH_ACCESS_DENIED');
  expect((await report('invalid')).error).toBe('INVALID_REPORT_OPTIONS');
  expect((await report('material',0,5001)).error).toBe('INVALID_REPORT_OPTIONS');
 });
});
