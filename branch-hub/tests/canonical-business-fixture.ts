// Canonical SQL + atomic outbox evidence. Disposable CI Auth/subscription fixtures only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanonicalMemoryDatabase } from '../experiments/canonical-memory-db.mjs';
import { createOperationStore } from '../runtime/operation-store.mjs';
import { createOperation } from '../prototype/operation-contract.mjs';
import { seedRlsFixture } from '../../tests/integration/rls';
import { attachRawComponentToUnit } from '../../tests/integration/componentTestFixtures';
import type pg from 'pg';
import { makeCanonicalSplitHandler } from './canonical-split-handler.mjs';
export async function prepareCanonicalAtomicFixture(){
  const lab=await createCanonicalMemoryDatabase(process.env.JOHNAS_TEST_PGLITE_PACKAGE_ROOT);
  const db=lab.db;
  try{
    for(const name of ['disable_subscription_guard.sql','seed_raw_material_branch.sql','permission_first_role_fixture.sql'])await db.exec(readFileSync(join(lab.root,'supabase/ci',name),'utf8'));
    await db.exec("SET app.ci_subscription_bypass='on'");
    const client={query:async(sql:string,params:unknown[]=[])=>params.length?db.query(sql,params):(await db.exec(sql)).at(-1)} as unknown as pg.Client;
    await db.exec('BEGIN');
    const ids=await seedRlsFixture(client);
    const productId=randomUUID(),unitId=randomUUID();
    await db.query(`UPDATE public.warehouses SET is_default=(id=$1) WHERE branch_id=$2`,[ids.whA,ids.branchA]);
    await db.query(`INSERT INTO public.products(id,name,branch_id,cost_price,sale_price,is_active) VALUES($1,'Atomic hub product',$2,10,20,true)`,[productId,ids.branchA]);
    await db.query(`INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,cost_price,sale_price,is_active) VALUES($1,$2,'Atomic hub unit','ready',$3,10,20,true)`,[unitId,`ATOM-${randomUUID()}`,ids.branchA]);
    await db.query('INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)',[productId,unitId]);
    await db.query('INSERT INTO public.inventory_unit_batches(unit_id,branch_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,10,10)',[unitId,ids.branchA,ids.whA]);
    await attachRawComponentToUnit(client,unitId,ids.branchA,ids.whA,10,10);
    await db.exec('UPDATE public.settings SET tax_enabled=false,tax_rate=0; COMMIT');
    const context={branchId:ids.branchA,deviceId:randomUUID(),userId:ids.users.cashier};
    const local=await createOperationStore({db,branchId:ids.branchA,authorize:async()=>true,handlers:{'sale.commit':makeCanonicalSplitHandler({warehouseId:ids.whA,shiftId:ids.shiftA})}});
    const op=(sequence:number)=>createOperation(context,{operationId:randomUUID(),sequence,kind:'sale.commit',createdAt:'2026-11-14T00:00:00.000Z',payload:{
      payments:[{payment_method:'cash',amount:'5.00'},{payment_method:'card',amount:'15.00'}],
      items:[{product_id:productId,unit_name:'piece',quantity:1,unit_price:'20.00',discount_amount:'0.00',bonus_quantity:0,total:'20.00'}]}});
    const quantity=async()=>Number((await db.query('SELECT sum(quantity)::text AS n FROM public.inventory_unit_batches WHERE unit_id=$1',[unitId])).rows[0].n);
    const rows=async()=> (await db.query(`SELECT count(*)::int AS sales,(SELECT count(*)::int FROM branch_hub_v1.outbox) AS outbox,
      (SELECT count(*)::int FROM public.sale_payments WHERE sale_id IN (SELECT id FROM public.sales WHERE invoice_number LIKE 'LOCAL-ATOMIC-%')) AS tenders
      FROM public.sales WHERE invoice_number LIKE 'LOCAL-ATOMIC-%'`)).rows[0];
    return {db,lab,ids,productId,unitId,context,local,op,quantity,rows};
  }catch(error){await db.close();throw error;}
}
