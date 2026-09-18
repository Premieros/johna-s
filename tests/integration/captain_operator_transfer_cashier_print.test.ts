import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

type Rpc = {
  success?: boolean;
  error?: string;
  order_id?: string;
  order_number?: string;
  items_sent_count?: number;
  sale_id?: string;
  station_code?: string;
  job_id?: string;
};

describe.skipIf(!dbUrl)('captain send + operator transfer + sale attribution + cashier print', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const productId = randomUUID();
  const unitId = randomUUID();
  const tableId = randomUUID();

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const res = await runAsPersist(client, userId, sql, params);
    if (res.error) throw new Error(res.error);
    return res.rows;
  };

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<Rpc> => {
    const rows = await asUser(userId, sql, params);
    return (rows[0]?.r || {}) as Rpc;
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    // Captain-like cashier: may create/edit/send/print, but cannot transfer or manage users.
    await client.query(`
      UPDATE public.roles
      SET permissions = (
        permissions
        || '["pos.view","pos.order.create","pos.order.edit","pos.send_kitchen","pos.receipt.print"]'::jsonb
      ) - 'pos.order.transfer' - 'users.manage'
      WHERE role='cashier'
    `);

    // Transfer authority is intentionally independent from users.manage.
    await client.query(`
      UPDATE public.roles
      SET permissions = (
        permissions
        || '["pos.view","pos.order.edit","pos.order.transfer","pos.payment.take"]'::jsonb
      ) - 'users.manage'
      WHERE role='branch_manager'
    `);

    // Another branch-scoped operator may have send permission but must not send someone else's order.
    await client.query(`
      UPDATE public.roles
      SET permissions = (
        permissions || '["pos.view","pos.order.edit","pos.send_kitchen"]'::jsonb
      ) - 'users.manage'
      WHERE role='warehouse_manager'
    `);

    await client.query(
      `UPDATE public.warehouses SET is_default=(id=$1) WHERE branch_id=$2`,
      [ids.whA, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,cost_price,sale_price,is_active)
       VALUES($1,'Captain transfer product',$2,10,20,true)`,
      [productId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
       VALUES($1,$2,'Captain transfer ready unit','ready',$3,10,20,true)`,
      [unitId, `CAP-${randomUUID()}`, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)`,
      [productId, unitId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches(unit_id,branch_id,warehouse_id,quantity,unit_cost)
       VALUES($1,$2,$3,10,10)`,
      [unitId, ids.branchA, ids.whA],
    );
    await client.query(
      `INSERT INTO public.dining_tables(id,name,branch_id,capacity,status,is_active)
       VALUES($1,'Captain QA Table',$2,4,'vacant',true)`,
      [tableId, ids.branchA],
    );
    await client.query(`UPDATE public.settings SET tax_enabled=false,tax_rate=0`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('lets a captain-like user send their own order but never another operator order', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const items = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 20,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 20,
    }]);

    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_order($1,'dine_in',$2,NULL,2,NULL,$3::jsonb,20,0,'amount',0,20,$4) AS r`,
      [ids.branchA, tableId, items, ids.users.cashier],
    );
    expect(created.success).toBe(true);
    const orderId = String(created.order_id);

    const blocked = await rpc(
      ids.users.warehouse_manager,
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    );
    expect(blocked).toMatchObject({ success: false, error: 'ORDER_OPERATOR_REQUIRED' });

    const sent = await rpc(
      ids.users.cashier,
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    );
    expect(sent.success, JSON.stringify(sent)).toBe(true);
    expect(sent.items_sent_count).toBe(1);

    const rolePerms = await client.query<{ has_transfer: boolean }>(
      `SELECT permissions ? 'pos.order.transfer' AS has_transfer FROM public.roles WHERE role='cashier'`,
    );
    expect(rolePerms.rows[0].has_transfer).toBe(false);

    (globalThis as unknown as { __captainOrderId?: string }).__captainOrderId = orderId;
  });

  it('queues the open POS check to the cashier station', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const orderId = (globalThis as unknown as { __captainOrderId?: string }).__captainOrderId!;
    expect(orderId).toBeTruthy();

    const queued = await rpc(
      ids.users.cashier,
      `SELECT public.enqueue_cloud_open_order_print($1,$2::jsonb,$3) AS r`,
      [orderId, JSON.stringify({ html: '<html>open check</html>', paperWidthMm: 80, copies: 1 }), `qa-open-check-${randomUUID()}`],
    );
    expect(queued.success, JSON.stringify(queued)).toBe(true);
    expect(queued.station_code).toBe('cashier');

    const job = await client.query<{ kind: string; station_code: string; requested_by: string }>(
      `SELECT kind,station_code,requested_by FROM public.cloud_print_jobs WHERE id=$1`,
      [queued.job_id],
    );
    expect(job.rows[0]).toEqual({
      kind: 'receipt',
      station_code: 'cashier',
      requested_by: ids.users.cashier,
    });
  });

  it('transfers ownership using pos.order.transfer alone and attributes the eventual sale to the new operator', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const orderId = (globalThis as unknown as { __captainOrderId?: string }).__captainOrderId!;

    const manageUsers = await client.query<{ has_users_manage: boolean; has_transfer: boolean }>(
      `SELECT
         permissions ? 'users.manage' AS has_users_manage,
         permissions ? 'pos.order.transfer' AS has_transfer
       FROM public.roles WHERE role='branch_manager'`,
    );
    expect(manageUsers.rows[0]).toEqual({ has_users_manage: false, has_transfer: true });

    const targets = await asUser(
      ids.users.branch_manager,
      `SELECT * FROM public.list_pos_order_transfer_targets($1)`,
      [orderId],
    );
    expect(targets.some((row) => String(row.user_id || '') === ids.users.branch_manager)).toBe(true);

    const transferred = await rpc(
      ids.users.branch_manager,
      `SELECT public.transfer_order_operator($1,$2) AS r`,
      [orderId, ids.users.branch_manager],
    );
    expect(transferred.success, JSON.stringify(transferred)).toBe(true);

    const owner = await client.query<{ cashier_id: string }>(
      `SELECT cashier_id FROM public.orders WHERE id=$1`,
      [orderId],
    );
    expect(owner.rows[0].cashier_id).toBe(ids.users.branch_manager);

    // Original captain no longer owns it and cannot send it.
    const oldOwnerBlocked = await rpc(
      ids.users.cashier,
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    );
    expect(oldOwnerBlocked).toMatchObject({ success: false, error: 'ORDER_OPERATOR_REQUIRED' });

    const items = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 20,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 20,
    }]);
    const invoice = `CAP-XFER-${randomUUID()}`;
    const sale = await rpc(
      ids.users.super_admin,
      `SELECT public.process_sale(
        p_invoice_number:=$1,
        p_branch_id:=$2,
        p_warehouse_id:=$3,
        p_customer_id:=NULL,
        p_salesperson_id:=NULL,
        p_subtotal:=20,
        p_discount_amount:=0,
        p_discount_type:='amount',
        p_tax_amount:=0,
        p_bonus_amount:=0,
        p_total:=20,
        p_paid_amount:=20,
        p_payment_method:='cash',
        p_status:='completed',
        p_items:=$4::jsonb,
        p_shift_id:=$5,
        p_order_type:='dine_in',
        p_table_id:=$6,
        p_order_id:=$7,
        p_guest_count:=2
      ) AS r`,
      [invoice, ids.branchA, ids.whA, items, ids.shiftA, tableId, orderId],
    );
    expect(sale.success, JSON.stringify(sale)).toBe(true);

    const attribution = await client.query<{
      cashier_id: string;
      salesperson_id: string;
      created_by: string;
    }>(
      `SELECT s.cashier_id,s.salesperson_id,so.created_by
       FROM public.sales s
       JOIN public.shift_operations so
         ON so.reference_type='sale' AND so.reference_id=s.id
       WHERE s.id=$1
       ORDER BY so.created_at
       LIMIT 1`,
      [sale.sale_id],
    );
    expect(attribution.rows[0].cashier_id).toBe(ids.users.branch_manager);
    expect(attribution.rows[0].salesperson_id).toBe(ids.users.branch_manager);
    expect(attribution.rows[0].created_by).toBe(ids.users.super_admin);

    const audit = await client.query<{ n: string }>(
      `SELECT count(*)::text n
       FROM public.audit_log
       WHERE entity='order' AND entity_id=$1 AND action='ORDER_OPERATOR_TRANSFERRED'`,
      [orderId],
    );
    expect(Number(audit.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  it('keeps internal sale core unavailable to authenticated callers', async () => {
    const { rows } = await client.query<{ allowed: boolean }>(`
      SELECT has_function_privilege(
        'authenticated',
        'public._process_sale_core(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,text,text,jsonb,uuid,text,uuid,uuid,integer)',
        'EXECUTE'
      ) AS allowed
    `);
    expect(rows[0].allowed).toBe(false);
  });
});
