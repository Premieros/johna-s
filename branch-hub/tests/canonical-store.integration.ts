// Canonical SQL + atomic outbox evidence. Disposable CI Auth/subscription fixtures only.
import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanonicalMemoryDatabase } from '../experiments/canonical-memory-db.mjs';
import { createOperationStore } from '../runtime/operation-store.mjs';
import { createOperation } from '../prototype/operation-contract.mjs';
import { seedRlsFixture } from '../../tests/integration/rls';
import { attachRawComponentToUnit } from '../../tests/integration/componentTestFixtures';
import type pg from 'pg';
type AtomicHandlerInput={
  tx:{query:(sql:string,params?:unknown[])=>Promise<{rows:Array<{result:Record<string,unknown>}>}>;exec:(sql:string)=>Promise<unknown>};
  context:{branchId:string;userId:string};
  operation:{operationId:string;payload:{payments:unknown[];items:unknown[]}};
};
it('commits canonical split tenders, stock and outbox together; rolls all effects back if outbox fails',async()=>{
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
    const local=await createOperationStore({db,branchId:ids.branchA,authorize:async()=>true,handlers:{'sale.commit':async({tx,context:scope,operation}:AtomicHandlerInput)=>{
      await tx.query("SELECT set_config('app.user_id',$1,true)",[scope.userId]);
      await tx.exec('SET LOCAL ROLE authenticated');
      try{
        return (await tx.query(`SELECT public.process_sale_split_idempotent(
          p_client_operation_key:=$1,p_invoice_number:=$2,p_branch_id:=$3,p_warehouse_id:=$4,
          p_customer_id:=NULL,p_salesperson_id:=NULL,p_subtotal:=20,p_discount_amount:=0,p_discount_type:='amount',
          p_tax_amount:=0,p_bonus_amount:=0,p_total:=20,p_payments:=$5::jsonb,p_status:='completed',p_items:=$6::jsonb,
          p_shift_id:=$7,p_order_type:='takeaway',p_table_id:=NULL,p_order_id:=NULL,p_guest_count:=NULL) AS result`,
          [operation.operationId,`LOCAL-ATOMIC-${operation.operationId}`,scope.branchId,ids.whA,JSON.stringify(operation.payload.payments),JSON.stringify(operation.payload.items),ids.shiftA])).rows[0].result;
      }finally{await tx.exec('RESET ROLE; RESET app.user_id');}
    }}});
    const op=(sequence:number)=>createOperation(context,{operationId:randomUUID(),sequence,kind:'sale.commit',createdAt:'2026-11-14T00:00:00.000Z',payload:{
      payments:[{payment_method:'cash',amount:'5.00'},{payment_method:'card',amount:'15.00'}],
      items:[{product_id:productId,unit_name:'piece',quantity:1,unit_price:'20.00',discount_amount:'0.00',bonus_quantity:0,total:'20.00'}]}});
    const quantity=async()=>Number((await db.query('SELECT sum(quantity)::text AS n FROM public.inventory_unit_batches WHERE unit_id=$1',[unitId])).rows[0].n);
    const rows=async()=> (await db.query(`SELECT count(*)::int AS sales,(SELECT count(*)::int FROM branch_hub_v1.outbox) AS outbox,
      (SELECT count(*)::int FROM public.sale_payments WHERE sale_id IN (SELECT id FROM public.sales WHERE invoice_number LIKE 'LOCAL-ATOMIC-%')) AS tenders
      FROM public.sales WHERE invoice_number LIKE 'LOCAL-ATOMIC-%'`)).rows[0];
    const first=op(1);const response=await local.commit(context,first);expect(response.result.success).toBe(true);
    expect(await rows()).toEqual({sales:1,outbox:1,tenders:2});expect(await quantity()).toBe(9);
    expect((await local.commit(context,first)).duplicate).toBe(true);expect(await quantity()).toBe(9);
    const second=op(2);
    await db.exec(`CREATE FUNCTION public.fail_atomic_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ATOMIC_OUTBOX_FAILURE'; END $$;
      CREATE TRIGGER atomic_outbox_failure BEFORE INSERT ON branch_hub_v1.outbox FOR EACH ROW EXECUTE FUNCTION public.fail_atomic_outbox()`);
    await expect(local.commit(context,second)).rejects.toThrow('ATOMIC_OUTBOX_FAILURE');
    expect(await rows()).toEqual({sales:1,outbox:1,tenders:2});expect(await quantity()).toBe(9);
    await db.exec('DROP TRIGGER atomic_outbox_failure ON branch_hub_v1.outbox');
    await local.commit(context,second);expect(await rows()).toEqual({sales:2,outbox:2,tenders:4});expect(await quantity()).toBe(8);
  }finally{await db.close();}
},120000);
