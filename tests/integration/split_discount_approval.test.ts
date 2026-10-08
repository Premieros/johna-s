import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('discount checkout failures and split invoice proof', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let approval: string;
  beforeEach(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    await client.query(`UPDATE public.roles SET permissions=permissions || '["pos.order.edit","pos.payment.take"]'::jsonb WHERE role='cashier'`);
    await client.query('UPDATE public.orders SET subtotal=20,total=20,inventory_warehouse_id=$2 WHERE id=$1', [ids.rows.orders.own,ids.whA]);
    await client.query(`INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity,sent_by)
      SELECT $2,order_id,id,1,$3 FROM public.order_items WHERE order_id=$1`, [ids.rows.orders.own,ids.branchA,ids.users.cashier]);
    await client.query(`INSERT INTO public.order_kitchen_inventory_events(order_id,order_item_id,branch_id,warehouse_id,sent_quantity)
      SELECT order_id,id,$2,$3,1 FROM public.order_items WHERE order_id=$1`, [ids.rows.orders.own,ids.branchA,ids.whA]);
    approval = (await client.query(`INSERT INTO public.approval_requests(branch_id,requester_id,action_type,entity_type,entity_id,payload,reason,status,expires_at)
      VALUES($1,$2,'discount','order',$3,'{"discount_amount":5,"discount_type":"amount","subtotal":20}','Split regression','approved',now()+interval '10 minutes') RETURNING id`,
      [ids.branchA,ids.users.cashier,ids.rows.orders.own])).rows[0].id;
    const saved = await runAsPersist(client,ids.users.cashier,'SELECT public.set_order_checkout_discount($1,5,$2) AS r',[ids.rows.orders.own,approval]);
    expect(saved.error).toBeUndefined();
    expect((saved.rows[0].r as {success:boolean}).success).toBe(true);
  });
  afterEach(async () => { if(client) { await client.query('ROLLBACK'); await client.end(); } });
  const split = async (invoice: string, paid: number, warehouse?: string) => {
    const preview = (await client.query('SELECT public._build_order_settlement_preview($1) AS r',[ids.rows.orders.own])).rows[0].r;
    const r = await runAsPersist(client,ids.users.cashier,
      `SELECT public.process_sale_split($1,$2,$3,NULL,NULL,20,5,'amount',0,0,15,$4::jsonb,'completed',$5::jsonb,$6,'dine_in',NULL,$7,NULL) AS r`,
      [invoice,ids.branchA,warehouse || ids.whA,JSON.stringify([{payment_method:'cash',amount:5},{payment_method:'card',amount:paid-5}]),JSON.stringify(preview.items),ids.shiftA,ids.rows.orders.own]);
    expect(r.error).toBeUndefined();
    return r.rows[0].r as {success:boolean;error?:string;sale_id?:string};
  };
  const approvalState = async () => (await client.query('SELECT status,consumed_at FROM public.approval_requests WHERE id=$1',[approval])).rows[0];
  it('preserves approval and all financial rows when split totals mismatch', async () => {
    expect((await split('SPLIT-DISCOUNT-BAD-'+approval,14)).success).toBe(false);
    expect(await approvalState()).toMatchObject({status:'approved',consumed_at:null});
    expect((await client.query('SELECT count(*)::int AS n FROM public.sales WHERE invoice_number=$1',['SPLIT-DISCOUNT-BAD-'+approval])).rows[0].n).toBe(0);
  });
  it('preserves approval if the sent warehouse validation fails', async () => {
    expect((await split('SPLIT-DISCOUNT-WH-'+approval,15,ids.whB)).success).toBe(false);
    expect(await approvalState()).toMatchObject({status:'approved',consumed_at:null});
  });
  it('records the approved split discount and two tenders with invoice-bound proof', async () => {
    const invoice='SPLIT-DISCOUNT-OK-'+approval;
    const r=await split(invoice,15);
    expect(r.success,JSON.stringify(r)).toBe(true);
    expect((await approvalState()).status).toBe('consumed');
    const sale=(await client.query('SELECT discount_amount::numeric,total::numeric,paid_amount::numeric,payment_method FROM public.sales WHERE id=$1',[r.sale_id])).rows[0];
    expect(Number(sale.discount_amount)).toBe(5);
    expect(Number(sale.total)).toBe(15);
    expect(Number(sale.paid_amount)).toBe(15);
    expect(sale.payment_method).toBe('split');
    expect((await client.query('SELECT count(*)::int AS n FROM public.sale_payments WHERE sale_id=$1',[r.sale_id])).rows[0].n).toBe(2);
    expect((await client.query("SELECT details->>'invoice_number' AS invoice FROM public.audit_log WHERE entity_id=$1 AND action='APPROVAL_CONSUMED'",[approval])).rows[0].invoice).toBe(invoice);
  });
  it('accepts a percentage approval persisted as an exact monetary order discount', async () => {
    await client.query(`UPDATE public.approval_requests SET payload=payload || '{"discount_type":"percent","requested_value":25}'::jsonb WHERE id=$1`,[approval]);
    const r=await split('SPLIT-PERCENT-'+approval,15);
    expect(r.success,JSON.stringify(r)).toBe(true);
    expect(Number((await client.query('SELECT discount_amount FROM public.sales WHERE id=$1',[r.sale_id])).rows[0].discount_amount)).toBe(5);
  });
  it('keeps normal-payment approval available after settlement validation fails', async () => {
    const r=await runAsPersist(client,ids.users.cashier,
      `SELECT public.process_sale($1,$2,$3,NULL,NULL,20,5,'amount',0,0,15,15,'cash','completed','[]'::jsonb,$4,'dine_in',NULL,$5,NULL) AS r`,
      ['NORMAL-DISCOUNT-WH-'+approval,ids.branchA,ids.whB,ids.shiftA,ids.rows.orders.own]);
    expect(r.error).toBeUndefined();
    expect((r.rows[0].r as {success:boolean}).success).toBe(false);
    expect(await approvalState()).toMatchObject({status:'approved',consumed_at:null});
  });
});
