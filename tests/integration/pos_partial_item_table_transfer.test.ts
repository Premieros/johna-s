import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { PosItemTransferResult } from '@/features/pos/types';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
const dbUrl = getDbUrl();
// This proof is intentionally restricted to an owned disposable PostgreSQL.
if (dbUrl && !['localhost', '127.0.0.1', '::1'].includes(new URL(dbUrl).hostname)) throw new Error('PARTIAL_TRANSFER_TEST_REQUIRES_OWNED_LOCAL_DATABASE');
describe.skipIf(!dbUrl)('partial table transfer against the full schema and actual guards', () => {
 let client: pg.Client, ids: RlsIds, impersonate = false;
 let productId: string;
 let source: string, target: string, targetTable: string, line: string, originalEvent: string;
 let expected: Record<string, unknown>;
 beforeAll(async () => {
  client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN');
  ids = await seedRlsFixture(client); impersonate = await canImpersonate(client);
  await client.query(`UPDATE public.roles SET permissions=(COALESCE(permissions,'[]'::jsonb)||'["pos.order.transfer"]'::jsonb)-'users.manage' WHERE role='cashier'`);
  const product = (await client.query(`INSERT INTO public.products(name,sale_price,cost_price,branch_id,product_type) VALUES('Partial water',20,3,$1,'ready') RETURNING id`, [ids.branchA])).rows[0].id;
  productId = product;
  const tables = (await client.query(`INSERT INTO public.dining_tables(branch_id,name,status) VALUES($1,$2,'occupied'),($1,$3,'occupied') RETURNING id`, [ids.branchA, `partial-source-${randomUUID()}`, `partial-target-${randomUUID()}`])).rows;
  targetTable = tables[1].id;
  const orders = (await client.query(`INSERT INTO public.orders(order_number,branch_id,order_type,status,table_id,cashier_id,subtotal,discount_amount,discount_type,tax_amount,total) VALUES($1,$3,'dine_in','open',$4,$6,60,6,'amount',0,54),($2,$3,'dine_in','open',$5,$6,20,0,'amount',0,20) RETURNING id`, [`PARTIAL-${randomUUID()}`, `PARTIAL-${randomUUID()}`, ids.branchA, tables[0].id, tables[1].id, ids.users.branch_manager])).rows;
  source = orders[0].id; target = orders[1].id;
  const lines = (await client.query(`INSERT INTO public.order_items(order_id,product_id,quantity,unit_price,total,notes) VALUES($1,$3,3,20,60,'water'),($2,$3,1,20,20,'water') RETURNING id,order_id`, [source,target,product])).rows;
  line = lines.find(r => r.order_id === source).id;
  for (const row of lines) {
   const qty = row.order_id === source ? 3 : 1;
   const send = (await client.query(`INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity,sent_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,[ids.branchA,row.order_id,row.id,qty,ids.users.branch_manager])).rows[0].id;
   const event = (await client.query(`INSERT INTO public.order_kitchen_inventory_events(branch_id,warehouse_id,order_id,order_item_id,kitchen_send_id,sent_quantity,total_cost,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[ids.branchA,ids.whA,row.order_id,row.id,send,qty,qty*3,ids.users.branch_manager])).rows[0].id;
   if(row.order_id === source) {
    originalEvent=event;
    // Supply a frozen send-time snapshot without asking today's price trigger
    // to recreate historical data. This UPDATE is test-fixture setup only.
    await client.query(`UPDATE public.order_kitchen_inventory_events SET snapshot_version=2,component_snapshot=$2::jsonb WHERE id=$1`, [event,JSON.stringify([{ raw_material_id: randomUUID(), quantity: 0.999999, unit_cost: 9, extended_cost: 9, price_source: 'purchase', priced_at: '2026-01-01T00:00:00Z' }])]);
   }
  }
  expected = (await client.query(`SELECT jsonb_build_object('quantity',quantity,'product_id',product_id,'unit_name',unit_name,'unit_price',unit_price,'discount_amount',discount_amount,'bonus_quantity',bonus_quantity,'notes',COALESCE(notes,''),'modifier_option_ids',COALESCE(to_jsonb(modifier_option_ids),'[]')) expected FROM public.order_items WHERE id=$1`,[line])).rows[0].expected;
 });
 afterAll(async () => { if(client){ await client.query('ROLLBACK').catch(()=>{}); await client.end(); } });
 it('splits sent 3 into exact 2+1, retains original prices and financial quantities, retries once and sends nothing new', async ctx => {
  if(!impersonate) return ctx.skip();
  await client.query('UPDATE public.products SET sale_price=99 WHERE id=$1',[productId]);
  const ledgerBefore = (await client.query(`SELECT count(*)::int n FROM public.inventory_ledger`)).rows[0].n;
  const payload = { operation_id: randomUUID(), quantities: [{order_item_id:line,quantity:1,expected}] };
  const transfer = async (p=payload) => runAsPersist(client,ids.users.cashier,`SELECT public.transfer_order_items_to_table($1,ARRAY[$2::uuid],$3,$4::jsonb) result`,[source,line,targetTable,JSON.stringify(p)]);
  const moved = await transfer(); expect(moved.error).toBeUndefined(); const result=moved.rows[0].result as PosItemTransferResult;
  expect(result,JSON.stringify(result)).toMatchObject({success:true,source_order_empty:false,inventory_changed:false,kds_resent:false});
  const newLine=result.quantity_transfers![0].moved_item_id; expect(newLine).not.toBe(line);
  expect((await client.query(`SELECT quantity::float8 q FROM public.order_items WHERE id=$1`,[line])).rows[0].q).toBe(2);
  expect((await client.query('SELECT unit_price::float8 price FROM public.order_items WHERE id=$1',[newLine])).rows[0].price).toBe(20);
  const targets=(await client.query(`SELECT id,quantity::float8 q FROM public.order_items WHERE order_id=$1`,[target])).rows;
  expect(targets).toHaveLength(2); expect(targets.find(r=>r.id===newLine)?.q).toBe(1);
  const events=(await client.query(`SELECT * FROM public.order_kitchen_inventory_events WHERE order_item_id=ANY($1::uuid[])`,[[line,newLine]])).rows;
  expect(events).toHaveLength(2); expect(events.find(e=>e.order_item_id===newLine).transfer_origin_event_id).toBe(originalEvent);
  expect(events.reduce((n,e)=>n+Number(e.total_cost),0)).toBe(9);
  expect(Number(events.reduce((n,e)=>n+Number(e.component_snapshot[0].quantity),0).toFixed(6))).toBe(0.999999);
  expect(events.every(e=>e.component_snapshot[0].price_source==='purchase' && e.component_snapshot[0].unit_cost===9)).toBe(true);
  expect((await client.query(`SELECT sum(subtotal)::float8 subtotal,sum(discount_amount)::float8 discount FROM public.orders WHERE id=ANY($1::uuid[])`,[[source,target]])).rows[0]).toMatchObject({subtotal:80,discount:6});
  expect((await transfer()).rows[0].result).toMatchObject({success:true,replayed:true});
  expect(((await transfer({...payload,quantities:[{...payload.quantities[0],quantity:2}]})).rows[0].result as PosItemTransferResult).error).toBe('TRANSFER_OPERATION_CONFLICT');
  expect(((await transfer({...payload,operation_id:randomUUID()})).rows[0].result as PosItemTransferResult).error).toBe('TRANSFER_SOURCE_CHANGED');
  const beforeSend=(await client.query(`SELECT count(*)::int n FROM public.order_kitchen_inventory_events`)).rows[0].n;
  const send=await runAsPersist(client,ids.users.cashier,`SELECT public.send_to_kitchen($1,NULL::uuid) result`,[target]);
  expect(send.error).toBeUndefined();expect(send.rows[0].result,JSON.stringify(send.rows[0].result)).toMatchObject({success:true,all_sent:true});
  expect((await client.query(`SELECT count(*)::int n FROM public.order_kitchen_inventory_events`)).rows[0].n).toBe(beforeSend);
  expect((await client.query(`SELECT count(*)::int n FROM public.inventory_ledger`)).rows[0].n).toBe(ledgerBefore);
  expect((await client.query(`SELECT count(*)::int n FROM public.audit_log WHERE id=$1`,[payload.operation_id])).rows[0].n).toBe(1);
 });
});
