import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type pg from 'pg';
import {getDbUrl,openDb} from './db';
import {canImpersonate,runAs,seedRlsFixture,type RlsIds} from './rls';
const dbUrl=getDbUrl();
type Result={rows:Record<string,unknown>[];summary:{count:number;total:number};metrics:Record<string,number>};
describe.skipIf(!dbUrl)('purchase material reporting under caller RLS',()=>{
 let client:pg.Client,ids:RlsIds;const raw=randomUUID(),soap=randomUUID(),prefix=`PR-${randomUUID()}`;
 beforeAll(async()=>{
  client=openDb(dbUrl!);await client.connect();await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='8s'");
  if(!await canImpersonate(client))throw new Error('Requires isolated CI auth stub');ids=await seedRlsFixture(client);
  await client.query(`INSERT INTO public.raw_materials(id,branch_id,code,name,category) VALUES($1,$2,$3,'Flour','Food'),($4,$2,$5,'Soap','Cleaning')`,[raw,ids.branchA,prefix+'F',soap,prefix+'S']);
  for(let n=0;n<2;n++){
   const purchase=randomUUID();await client.query(`INSERT INTO public.purchases(id,invoice_number,branch_id,warehouse_id,supplier_id,buyer_id,subtotal,discount_amount,tax_amount,total,paid_amount,returned_amount,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,150,50,10,110,0,20,'credit','completed')`,[purchase,`${prefix}-${n}`,ids.branchA,ids.whA,ids.suppA,ids.users.accountant]);
   await client.query(`INSERT INTO public.purchase_items(purchase_id,raw_material_id,unit_name,quantity,unit_cost,total,returned_quantity,returned_amount) VALUES($1,$2,'kg',10,10,100,2,20),($1,$3,'piece',5,10,50,0,0)`,[purchase,raw,soap]);
  }
 });
 afterAll(async()=>{if(client){await client.query('ROLLBACK').catch(()=>{});await client.end();}});
 async function read(view:string,filters:Record<string,string>={},page=0,size=100,user?:string,branch?:string):Promise<Result>{
  const result=await runAs(client,user || ids.users.cashier,`SELECT public.get_operational_report_page('purchases',$1,CURRENT_DATE-1,CURRENT_DATE+1,$2,$3,$4) r`,[branch || ids.branchA,{buyer:ids.users.accountant,purchase_view:view,...filters},page,size]);
  expect(result.error).toBeUndefined();return result.rows[0].r as Result;
 }
 it('keeps net invoice totals and recorded line values distinct, including recorded returns',async()=>{
  expect((await read('invoice')).summary).toEqual({count:2,total:180});
  const material=await read('material');expect(material.summary).toEqual({count:2,total:260});
  expect(material.metrics).toEqual({'Line Gross':300,'Line Returned':40,'Line Net':260});
  expect(material.rows.find(row=>row.raw_material_id===raw)).toMatchObject({quantity:20,returned_quantity:4,net_quantity:16,line_net:160,unit_name:'kg'});
  expect((await read('category',{material_category:'Food'})).summary).toEqual({count:1,total:160});
  expect((await read('material',{raw_material:soap})).summary).toEqual({count:1,total:100});
  const supplier=await read('supplier');expect(supplier.summary).toEqual({count:1,total:180});expect(supplier.rows[0]).toMatchObject({invoice_count:2,net_total:180});
 });
 it('returns full metrics with each bounded page and the same source for export',async()=>{
  const first=await read('material',{},0,1),next=await read('material',{},1,1);expect(first.summary).toEqual({count:2,total:260});expect(first.metrics).toEqual(next.metrics);expect(first.rows[0].raw_material_id).not.toBe(next.rows[0].raw_material_id);
  const full=await runAs(client,ids.users.cashier,`SELECT public.get_operational_report_dataset('purchases',$1,CURRENT_DATE-1,CURRENT_DATE+1,$2) r`,[ids.branchA,{buyer:ids.users.accountant,purchase_view:'material'}]);expect(full.error).toBeUndefined();expect((full.rows[0].r as Result).rows).toHaveLength(2);expect((full.rows[0].r as Result).metrics).toEqual(first.metrics);
 });
 it('applies foreign-branch denial and additional restrictive line policies to details and totals',async()=>{
  for(const view of ['invoice','material','category','supplier'])expect((await read(view,{},0,100,ids.users.cashier_b)).summary).toEqual({count:0,total:0});
  await client.query('SAVEPOINT extra_line_policy');
  try{
   await client.query(`CREATE POLICY purchase_report_hidden_fixture ON public.purchase_items AS RESTRICTIVE FOR SELECT TO authenticated USING(raw_material_id IS DISTINCT FROM '${soap}'::uuid)`);
   const result=await read('material');expect(result.summary).toEqual({count:1,total:160});expect(result.rows).toHaveLength(1);
  }finally{await client.query('ROLLBACK TO SAVEPOINT extra_line_policy');await client.query('RELEASE SAVEPOINT extra_line_policy');}
 });
});
