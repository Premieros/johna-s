import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

type Rpc = {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  sale_id?: string;
  items_sent_count?: number;
  job_id?: string;
  station_code?: string;
  cashier_id?: string;
};

describe.skipIf(!dbUrl)('action-specific POS permissions across operator ownership', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const productId = randomUUID();
  const unitId = randomUUID();

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<Rpc> => {
    const rows = await asUser(userId, sql, params);
    return (rows[0]?.r || {}) as Rpc;
  };

  const setActorPermissions = async (permissions: string[]) => {
    await client.query(
      `UPDATE public.roles SET permissions=$1::jsonb WHERE role='branch_manager'`,
      [JSON.stringify(permissions)],
    );
  };

  const newTable = async (branchId = ids.branchA) => {
    const tableId = randomUUID();
    await client.query(
      `INSERT INTO public.dining_tables(id,branch_id,name,capacity,status,is_active)
       VALUES($1,$2,$3,4,'vacant',true)`,
      [tableId, branchId, `ACT-${tableId.slice(0, 6)}`],
    );
    return tableId;
  };

  const itemPayload = (product = productId, qty = 1) => JSON.stringify([{
    product_id: product,
    unit_name: 'piece',
    quantity: qty,
    unit_price: 20,
    discount_amount: 0,
    bonus_quantity: 0,
    total: qty * 20,
  }]);

  const createOwnedOrder = async (tableId: string) => {
    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_order(
        $1,'dine_in',$2,NULL,2,'action contract',$3::jsonb,
        20,0,'amount',0,20,$4
      ) AS r`,
      [ids.branchA, tableId, itemPayload(), ids.users.cashier],
    );
    expect(created.success, JSON.stringify(created)).toBe(true);
    return String(created.order_id);
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    await client.query(
      `UPDATE public.roles
       SET permissions=permissions
         || '["pos.view","pos.order.create","pos.order.edit","pos.send_kitchen"]'::jsonb
       WHERE role='cashier'`,
    );
    await client.query(
      `UPDATE public.warehouses
       SET is_default=(id=$1)
       WHERE branch_id=$2`,
      [ids.whA, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.products(id,name,branch_id,cost_price,sale_price,is_active)
       VALUES($1,'Action Permission Product',$2,10,20,true)`,
      [productId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_units(
         id,code,name,unit_type,branch_id,cost_price,sale_price,is_active
       ) VALUES($1,$2,'Action Permission Unit','ready',$3,10,20,true)`,
      [unitId, `ACT-${randomUUID()}`, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.product_unit_links(product_id,unit_id,quantity)
       VALUES($1,$2,1)`,
      [productId, unitId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches(
         unit_id,branch_id,warehouse_id,quantity,unit_cost
       ) VALUES($1,$2,$3,50,10)`,
      [unitId, ids.branchA, ids.whA],
    );
    await client.query(`UPDATE public.settings SET tax_enabled=false,tax_rate=0`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('lets payment-only settle another operator order without edit/transfer/user-management authority', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const tableId = await newTable();
    const orderId = await createOwnedOrder(tableId);
    const sent = await rpc(
      ids.users.cashier,
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    );
    expect(sent.success, JSON.stringify(sent)).toBe(true);

    await setActorPermissions(['pos.view', 'pos.payment.take']);

    const access = await rpc(
      ids.users.branch_manager,
      `SELECT public.authorize_pos_order_access($1) AS r`,
      [orderId],
    );
    expect(access.success, JSON.stringify(access)).toBe(true);

    const blockedEdit = await rpc(
      ids.users.branch_manager,
      `SELECT public.update_order(
        $1,'dine_in',$2,NULL,2,'forbidden edit',$3::jsonb,
        20,0,'amount',0,20,'open'
      ) AS r`,
      [orderId, tableId, itemPayload()],
    );
    expect(blockedEdit.success).toBe(false);

    const invoice = `ACTION-PAY-${randomUUID()}`;
    const paid = await rpc(
      ids.users.branch_manager,
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
      [invoice, ids.branchA, ids.whA, itemPayload(), ids.shiftA, tableId, orderId],
    );
    expect(paid.success, JSON.stringify(paid)).toBe(true);

    const attribution = await client.query<{
      sale_owner: string;
      collected_by: string;
      order_owner: string;
      order_status: string;
    }>(
      `SELECT
         s.cashier_id AS sale_owner,
         so.created_by AS collected_by,
         o.cashier_id AS order_owner,
         o.status AS order_status
       FROM public.sales s
       JOIN public.shift_operations so
         ON so.reference_type='sale' AND so.reference_id=s.id
       JOIN public.orders o ON o.id=$2
       WHERE s.id=$1
       ORDER BY so.created_at
       LIMIT 1`,
      [paid.sale_id, orderId],
    );
    expect(attribution.rows[0]).toMatchObject({
      sale_owner: ids.users.cashier,
      collected_by: ids.users.branch_manager,
      order_owner: ids.users.cashier,
      order_status: 'completed',
    });
  });

  it('lets receipt-print permission queue another operator open check without changing print routing', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const tableId = await newTable();
    const orderId = await createOwnedOrder(tableId);
    await setActorPermissions(['pos.receipt.print']);

    const queued = await rpc(
      ids.users.branch_manager,
      `SELECT public.enqueue_cloud_open_order_print($1,$2::jsonb,$3) AS r`,
      [
        orderId,
        JSON.stringify({ text: 'ACTION PRINT CONTRACT', paperWidthMm: 80, copies: 1 }),
        `action-print-${randomUUID()}`,
      ],
    );
    expect(queued.success, JSON.stringify(queued)).toBe(true);
    expect(queued.station_code).toBe('cashier');

    const job = await client.query<{
      kind: string;
      station_code: string;
      requested_by: string;
    }>(
      `SELECT kind,station_code,requested_by
       FROM public.cloud_print_jobs
       WHERE id=$1`,
      [queued.job_id],
    );
    expect(job.rows[0]).toEqual({
      kind: 'receipt',
      station_code: 'cashier',
      requested_by: ids.users.branch_manager,
    });

    const owner = await client.query<{ cashier_id: string }>(
      `SELECT cashier_id FROM public.orders WHERE id=$1`,
      [orderId],
    );
    expect(owner.rows[0].cashier_id).toBe(ids.users.cashier);
  });

  it('lets send-kitchen permission send another operator delta while preserving owner and deducting once', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const tableId = await newTable();
    const orderId = await createOwnedOrder(tableId);
    await setActorPermissions(['pos.view', 'pos.send_kitchen']);

    const before = await client.query<{ qty: string }>(
      `SELECT COALESCE(sum(quantity),0)::text qty
       FROM public.inventory_unit_batches
       WHERE unit_id=$1 AND warehouse_id=$2`,
      [unitId, ids.whA],
    );

    const sent = await rpc(
      ids.users.branch_manager,
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    );
    expect(sent.success, JSON.stringify(sent)).toBe(true);
    expect(sent.items_sent_count).toBe(1);

    const after = await client.query<{ qty: string }>(
      `SELECT COALESCE(sum(quantity),0)::text qty
       FROM public.inventory_unit_batches
       WHERE unit_id=$1 AND warehouse_id=$2`,
      [unitId, ids.whA],
    );
    expect(Number(after.rows[0].qty)).toBe(Number(before.rows[0].qty) - 1);

    const row = await client.query<{ cashier_id: string; sent_by: string }>(
      `SELECT o.cashier_id,s.sent_by
       FROM public.orders o
       JOIN public.order_kitchen_sends s ON s.order_id=o.id
       WHERE o.id=$1
       LIMIT 1`,
      [orderId],
    );
    expect(row.rows[0]).toEqual({
      cashier_id: ids.users.cashier,
      sent_by: ids.users.branch_manager,
    });
  });

  it('lets cancel permission cancel another operator unsent order but does not grant edit', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const tableId = await newTable();
    const orderId = await createOwnedOrder(tableId);
    await setActorPermissions(['pos.view', 'pos.cancel_order']);

    const blockedEdit = await rpc(
      ids.users.branch_manager,
      `SELECT public.update_order(
        $1,'dine_in',$2,NULL,2,'forbidden edit',$3::jsonb,
        20,0,'amount',0,20,'open'
      ) AS r`,
      [orderId, tableId, itemPayload()],
    );
    expect(blockedEdit.success).toBe(false);

    const cancelled = await rpc(
      ids.users.branch_manager,
      `SELECT public.set_order_status($1,'cancelled','guest cancelled') AS r`,
      [orderId],
    );
    expect(cancelled.success, JSON.stringify(cancelled)).toBe(true);

    const row = await client.query<{
      status: string;
      cashier_id: string;
      table_status: string;
    }>(
      `SELECT o.status,o.cashier_id,t.status AS table_status
       FROM public.orders o
       JOIN public.dining_tables t ON t.id=o.table_id
       WHERE o.id=$1`,
      [orderId],
    );
    expect(row.rows[0]).toEqual({
      status: 'cancelled',
      cashier_id: ids.users.cashier,
      table_status: 'vacant',
    });
  });

  it('keeps cross-branch action attempts blocked', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const tableB = await newTable(ids.branchB);
    const foreignItems = JSON.stringify([{
      product_id: ids.prodB,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 20,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 20,
    }]);

    const foreign = await rpc(
      ids.users.cashier_b,
      `SELECT public.create_order(
        $1,'dine_in',$2,NULL,2,'foreign order',$3::jsonb,
        20,0,'amount',0,20,$4
      ) AS r`,
      [ids.branchB, tableB, foreignItems, ids.users.cashier_b],
    );
    expect(foreign.success, JSON.stringify(foreign)).toBe(true);

    await setActorPermissions(['pos.view', 'pos.cancel_order']);
    const blocked = await rpc(
      ids.users.branch_manager,
      `SELECT public.set_order_status($1,'cancelled','cross branch attempt') AS r`,
      [foreign.order_id],
    );
    expect(blocked).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });
});
