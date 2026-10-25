import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAs, seedRlsFixture, type RlsIds } from './rls';
import { attachRawComponentToUnit } from './componentTestFixtures';

const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const types = ['dine_in', 'takeaway', 'drive_thru', 'delivery'] as const;
describe.skipIf(!local)('one create-and-send capability per order type — owned localhost', () => {
  let db: pg.Client; let ids: RlsIds;
  const table = randomUUID(); const unit = randomUUID();
  const orders = new Map<string, string>();
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='8s'");
    ids = await seedRlsFixture(db);
    await db.query(`INSERT INTO public.dining_tables(id,name,branch_id,status) VALUES($1,'TYPE QA',$2,'vacant')`, [table, ids.branchA]);
    await db.query(`UPDATE public.warehouses SET is_default=(id=$1) WHERE branch_id=$2`, [ids.whA, ids.branchA]);
    await db.query(`INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,cost_price,sale_price,is_active) VALUES($1,$2,'Type QA','ready',$3,1,20,true)`, [unit, randomUUID(), ids.branchA]);
    await db.query(`INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)`, [ids.prodA, unit]);
    await attachRawComponentToUnit(db, unit, ids.branchA, ids.whA, 100, 1);
    for (const type of types) {
      const order = randomUUID(); orders.set(type, order);
      await db.query(`INSERT INTO public.orders(id,order_number,branch_id,cashier_id,order_type,status,table_id) VALUES($1,$2,$3,$4,$5,'open',$6)`, [order, randomUUID(), ids.branchA, ids.users.cashier, type, type === 'dine_in' ? table : null]);
    }
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  async function grant(type: string) {
    await db.query(`UPDATE public.roles SET permissions=$1::jsonb WHERE role='cashier'`, [JSON.stringify(['pos.view', `pos.order.${type}`])]);
  }
  for (const type of types) {
    it(`${type} creates and sends without edit/payment/receipt or another type`, async () => {
      await grant(type);
      // One statement and one savepoint: no retained orders or print jobs.
      const result = await runAs(db, ids.users.cashier, `WITH created AS MATERIALIZED (
        SELECT public.create_order($1,$2,p_items:=$3::jsonb) r
      ) SELECT r, CASE WHEN (r->>'success')::boolean THEN public.send_to_kitchen((r->>'order_id')::uuid) END sent FROM created`,
      [ids.branchA, type, JSON.stringify([{product_id: ids.prodA, quantity: 1, unit_name: 'piece', unit_price: 20, total: 20}])]);
      expect(result.error).toBeUndefined();
      expect(result.rows[0].r).toMatchObject({success: true});
      expect(result.rows[0].sent, JSON.stringify(result.rows[0].sent)).toMatchObject({success: true, items_sent_count: 1});
      const permissions = await runAs(db, ids.users.cashier, `SELECT public.can_permission('pos.order.edit') edit,public.can_permission('pos.payment.take') pay,public.can_permission('pos.receipt.print') receipt,public.can_permission('pos.discount') discount`);
      expect(permissions.rows[0]).toEqual({edit: false, pay: false, receipt: false, discount: false});
      for (const other of types.filter(candidate => candidate !== type)) {
        const denied = await runAs(db, ids.users.cashier, 'SELECT public.send_to_kitchen($1) r', [orders.get(other)]);
        expect(denied.rows[0].r).toMatchObject({success: false, error: 'PERMISSION_DENIED'});
        const deniedCreate = await runAs(db, ids.users.cashier, `SELECT public.create_order($1,$2,p_items:=$3::jsonb) r`, [ids.branchA, other, JSON.stringify([{product_id: ids.prodA, quantity: 1, unit_price: 20, total: 20}])]);
        expect(deniedCreate.rows[0].r).toMatchObject({success: false, error: 'PERMISSION_DENIED'});
      }
    });
  }
  it('legacy generic permissions alone grant no type and quick cannot carry a table binding', async () => {
    await db.query(`UPDATE public.roles SET permissions='["pos.view","pos.order.create","pos.order.quick_create","pos.send_kitchen"]'::jsonb WHERE role='cashier'`);
    const denied = await runAs(db, ids.users.cashier, 'SELECT public.send_to_kitchen($1) r', [orders.get('dine_in')]);
    expect(denied.rows[0].r).toMatchObject({success: false, error: 'PERMISSION_DENIED'});
    await grant('takeaway');
    const bound = await runAs(db, ids.users.cashier, `SELECT public.create_order($1,'takeaway',$2,p_items:=$3::jsonb) r`, [ids.branchA, table, JSON.stringify([{product_id: ids.prodA, quantity: 1, unit_price: 20, total: 20}])]);
    expect(bound.rows[0].r).toMatchObject({success: false, error: 'PERMISSION_DENIED'});
    const direct = await runAs(db, ids.users.cashier, `INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type) VALUES($1,$2,$3,'dine_in')`, [randomUUID(), ids.branchA, ids.users.cashier]);
    expect(direct.error).toContain('PERMISSION_DENIED');
    const completed = await runAs(db, ids.users.cashier, `INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type,status) VALUES($1,$2,$3,'takeaway','completed')`, [randomUUID(), ids.branchA, ids.users.cashier]);
    expect(completed.error).toContain('PERMISSION_DENIED');
    const held = await runAs(db, ids.users.cashier, `INSERT INTO public.orders(order_number,branch_id,cashier_id,order_type,status) VALUES($1,$2,$3,'takeaway','held')`, [randomUUID(), ids.branchA, ids.users.cashier]);
    expect(held.error).toContain('PERMISSION_DENIED');
  });
  it('cannot use type changes, foreign branch, or forged print payload type to bypass authorization', async () => {
    await grant('takeaway');
    await db.query(`UPDATE public.roles SET permissions=permissions || '["pos.order.edit"]'::jsonb WHERE role='cashier'`);
    const changed = await runAs(db, ids.users.cashier, `UPDATE public.orders SET order_type='delivery' WHERE id=$1`, [orders.get('takeaway')]);
    expect(changed.error).toContain('PERMISSION_DENIED');
    const print = await runAs(db, ids.users.cashier, `SELECT public.enqueue_cloud_kitchen_print($1,'main',$2::jsonb,$3) r`, [ids.branchA, JSON.stringify({order_id: orders.get('dine_in'), order_type: 'takeaway', text: 'TYPE QA'}), randomUUID()]);
    expect(print.rows[0].r).toMatchObject({success: false, error: 'PERMISSION_DENIED'});
    const foreign = await runAs(db, ids.users.cashier, `SELECT public.create_order($1,'takeaway',p_items:=$2::jsonb) r`, [ids.branchB, JSON.stringify([{product_id: ids.prodB, quantity: 1, unit_price: 20, total: 20}])]);
    expect(foreign.rows[0].r).toMatchObject({success: false, error: 'BRANCH_MISMATCH'});
  });
});
