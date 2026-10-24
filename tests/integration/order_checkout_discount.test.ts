import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('order checkout discount authorization', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let approvalId: string;
  const apply = async (user: string, order: string, amount: number, approval: string | null) => {
    const r = await runAsPersist(client, user,
      'SELECT public.set_order_checkout_discount($1,$2,$3) AS r', [order, amount, approval]);
    if (r.error) throw new Error(r.error);
    return r.rows[0].r as {success: boolean; error?: string};
  };
  beforeAll(async () => {
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
    const r = await client.query(`INSERT INTO public.approval_requests(branch_id,requester_id,action_type,entity_type,entity_id,payload,reason,status,expires_at)
      VALUES($1,$2,'discount','order',$3,'{"discount_amount":20,"subtotal":20}','Checkout regression','approved',now()+interval '10 minutes') RETURNING id`,
      [ids.branchA,ids.users.cashier,ids.rows.orders.own]);
    approvalId = r.rows[0].id;
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end(); } });
  it('rejects missing approval and preserves the saved header', async () => {
    expect(await apply(ids.users.cashier,ids.rows.orders.own,20,null)).toMatchObject({success:false,error:'MANAGER_APPROVAL_REQUIRED'});
    expect(Number((await client.query('SELECT discount_amount FROM public.orders WHERE id=$1',[ids.rows.orders.own])).rows[0].discount_amount)).toBe(0);
  });
  it('rejects cross-branch targets and approval amount mismatches', async () => {
    expect((await apply(ids.users.cashier,ids.rows.orders.other,20,approvalId)).success).toBe(false);
    expect(await apply(ids.users.cashier,ids.rows.orders.own,10,approvalId)).toMatchObject({success:false,error:'MANAGER_APPROVAL_REQUIRED'});
  });
  it('applies the exact approved discount under authenticated RLS without consuming it', async () => {
    expect(await apply(ids.users.cashier,ids.rows.orders.own,20,approvalId)).toMatchObject({success:true,discount_amount:20,total:0});
    expect((await client.query('SELECT status FROM public.approval_requests WHERE id=$1',[approvalId])).rows[0].status).toBe('approved');
  });
  it('applies the same cashier approval to another operator order without leaking payment authority', async () => {
    const before=await client.query("SELECT current_setting('app.pos_action_authorized',true) enabled,current_setting('app.pos_action_actor_id',true) actor,current_setting('app.pos_action_order_id',true) target,current_setting('app.pos_action_permission',true) permission");
    await client.query('UPDATE public.orders SET cashier_id=$2 WHERE id=$1',[ids.rows.orders.own,ids.users.branch_manager]);
    try {
      expect(await apply(ids.users.cashier,ids.rows.orders.own,20,approvalId)).toMatchObject({success:true,discount_amount:20,total:0});
      const after=await client.query("SELECT current_setting('app.pos_action_authorized',true) enabled,current_setting('app.pos_action_actor_id',true) actor,current_setting('app.pos_action_order_id',true) target,current_setting('app.pos_action_permission',true) permission");
      expect(after.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value??''])))).toEqual(before.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value??'']))));
      const forbidden=await runAs(client,ids.users.cashier,'UPDATE public.orders SET discount_amount=1 WHERE id=$1',[ids.rows.orders.own]);
      expect(forbidden.error).toContain('ORDER_OPERATOR_REQUIRED');
    } finally {
      await client.query('UPDATE public.orders SET cashier_id=$2 WHERE id=$1',[ids.rows.orders.own,ids.users.cashier]);
    }
  });
  it('rejects expiry instead of silently replacing the discount', async () => {
    await client.query("UPDATE public.approval_requests SET expires_at=now()-interval '1 second' WHERE id=$1",[approvalId]);
    expect(await apply(ids.users.cashier,ids.rows.orders.own,20,approvalId)).toMatchObject({success:false,error:'MANAGER_APPROVAL_REQUIRED'});
    await client.query("UPDATE public.approval_requests SET expires_at=now()+interval '10 minutes' WHERE id=$1",[approvalId]);
  });
  it('settles the approved cashier discount once and records it on the invoice', async () => {
    const invoice=`APPROVED-CHECKOUT-${approvalId}`;
    const r=await runAsPersist(client,ids.users.cashier,
      `SELECT public.process_sale($1,$2,$3,NULL,NULL,20,20,'amount',0,0,0,0,'cash','completed','[]'::jsonb,$4,'dine_in',NULL,$5,NULL) AS r`,
      [invoice,ids.branchA,ids.whA,ids.shiftA,ids.rows.orders.own]);
    expect(r.error).toBeUndefined();
    const sale=r.rows[0]?.r as {success:boolean; sale_id?:string};
    expect(sale.success,JSON.stringify(sale)).toBe(true);
    const stored=await client.query('SELECT discount_amount,total FROM public.sales WHERE id=$1',[sale.sale_id]);
    expect(Number(stored.rows[0].discount_amount)).toBe(20);
    expect(Number(stored.rows[0].total)).toBe(0);
    expect((await client.query('SELECT status FROM public.approval_requests WHERE id=$1',[approvalId])).rows[0].status).toBe('consumed');
  });
  it('cannot reuse consumed proof for a different invoice through direct insertion', async () => {
    const r = await runAs(client,ids.users.cashier,
      `INSERT INTO public.sales(invoice_number,branch_id,subtotal,discount_amount,total,paid_amount,payment_method,status)
       VALUES($1,$2,20,20,0,0,'cash','completed')`, [`REPLAY-${approvalId}`,ids.branchA]);
    expect(r.error).toContain('DISCOUNT_NOT_ALLOWED');
  });
});
