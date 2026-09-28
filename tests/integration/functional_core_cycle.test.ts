import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { attachRawComponentToUnit, rawQtyForUnit } from './componentTestFixtures';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  sale_id?: string;
  items_sent_count?: number;
  shift_id?: string;
  requestId?: string;
  status?: string;
};

describe.skipIf(skip)('functional core cycle: shift → order → hold/resume → kitchen → payment → inventory', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;

  const productId = randomUUID();
  const unitId = randomUUID();
  const invoiceNumber = `FUNC-${randomUUID()}`;

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<RpcResult> => {
    const rows = await asUser(userId, sql, params);
    return (rows[0]?.r || {}) as RpcResult;
  };

  const stockQty = async (): Promise<number> => rawQtyForUnit(client, unitId, ids.branchA, ids.whA);

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    // The shared RLS fixture intentionally carries an open order only for policy probes.
    // Mark that unrelated probe settled so this test exercises the order it creates below.
    await client.query(
      `UPDATE public.orders
          SET payment_status = 'paid', payment_at = now()
        WHERE id = $1`,
      [ids.rows.orders.own],
    );

    await client.query(`
      UPDATE public.roles
         SET permissions = COALESCE(permissions, '[]'::jsonb)
           || '["pos.view","pos.order.create","pos.order.edit","pos.hold","pos.send_kitchen","pos.payment.take","shifts.close"]'::jsonb
       WHERE role = 'cashier'
    `);

    await client.query(
      `UPDATE public.warehouses
          SET is_default = (id = $1::uuid)
        WHERE branch_id = $2::uuid`,
      [ids.whA, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.products(id, name, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, 'Functional Burger', $2, 10, 20, true)`,
      [productId, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.inventory_units(id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'Functional Ready Unit', 'ready', $3, 10, 20, true)`,
      [unitId, `FUNC-${randomUUID()}`, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.product_unit_links(product_id, unit_id, quantity)
       VALUES ($1, $2, 1)`,
      [productId, unitId],
    );

    await client.query(
      `INSERT INTO public.inventory_unit_batches(unit_id, branch_id, warehouse_id, quantity, unit_cost)
       VALUES ($1, $2, $3, 10, 10)`,
      [unitId, ids.branchA, ids.whA],
    );
    await attachRawComponentToUnit(client, unitId, ids.branchA, ids.whA, 10, 10);

    await client.query(`UPDATE public.settings SET tax_enabled = false, tax_rate = 0`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('runs one complete cashier cycle and preserves stock/payment attribution', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const requirement = await rpc(
      ids.users.super_admin,
      `SELECT public.set_work_authorization_requirement($1,$2,true) AS r`,
      [ids.users.cashier, ids.branchA],
    );
    expect(requirement.success).toBe(true);

    const blockedBeforeAuthorization = await asUser(
      ids.users.cashier,
      `SELECT public.can_user_work($1) AS allowed`,
      [ids.branchA],
    );
    expect(blockedBeforeAuthorization[0].allowed).toBe(false);

    const requested = await rpc(
      ids.users.cashier,
      `SELECT public.request_work_authorization($1) AS r`,
      [ids.branchA],
    );
    expect(requested.status).toBe('pending');
    expect(requested.requestId).toBeTruthy();

    const approved = await rpc(
      ids.users.super_admin,
      `SELECT public.decide_work_authorization($1,true,$2) AS r`,
      [requested.requestId, 'Golden path authorization'],
    );
    expect(approved.success).toBe(true);
    expect(approved.status).toBe('approved');

    const allowedAfterAuthorization = await asUser(
      ids.users.cashier,
      `SELECT public.can_user_work($1) AS allowed`,
      [ids.branchA],
    );
    expect(allowedAfterAuthorization[0].allowed).toBe(true);

    const activeShift = await rpc(ids.users.cashier, `SELECT public.get_active_shift($1) AS r`, [ids.branchA]);
    expect(activeShift.success).not.toBe(false);

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
      `SELECT public.create_order($1, 'takeaway', NULL, NULL, 1, 'functional cycle', $2::jsonb, 20, 0, 'amount', 0, 20, NULL) AS r`,
      [ids.branchA, items],
    );
    expect(created.success).toBe(true);
    expect(created.order_id).toBeTruthy();
    const orderId = String(created.order_id);

    const createdRow = await client.query<{ cashier_id: string; branch_id: string; status: string }>(
      `SELECT cashier_id, branch_id, status FROM public.orders WHERE id = $1`,
      [orderId],
    );
    expect(createdRow.rows[0]).toMatchObject({
      cashier_id: ids.users.cashier,
      branch_id: ids.branchA,
      status: 'open',
    });

    const held = await rpc(
      ids.users.cashier,
      `SELECT public.set_order_status($1, 'held', 'functional hold') AS r`,
      [orderId],
    );
    expect(held.success).toBe(true);

    const heldRow = await client.query<{ status: string }>(`SELECT status FROM public.orders WHERE id = $1`, [orderId]);
    expect(heldRow.rows[0].status).toBe('held');

    const resumed = await rpc(
      ids.users.cashier,
      `SELECT public.set_order_status($1, 'open', 'functional resume') AS r`,
      [orderId],
    );
    expect(resumed.success).toBe(true);

    const beforeKitchen = await stockQty();
    expect(beforeKitchen).toBe(10);

    const kitchen = await rpc(ids.users.cashier, `SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(kitchen.success).toBe(true);
    expect(kitchen.items_sent_count).toBe(1);
    expect(await stockQty()).toBe(9);

    const kitchenAudit = await client.query<{ sent_by: string; inventory_by: string }>(
      `SELECT s.sent_by, e.created_by AS inventory_by
         FROM public.order_kitchen_sends s
         JOIN public.order_kitchen_inventory_events e ON e.order_item_id = s.order_item_id
        WHERE s.order_id = $1
        ORDER BY e.created_at ASC
        LIMIT 1`,
      [orderId],
    );
    expect(kitchenAudit.rows[0]).toMatchObject({
      sent_by: ids.users.cashier,
      inventory_by: ids.users.cashier,
    });

    const paid = await rpc(
      ids.users.cashier,
      `SELECT public.process_sale(
         p_invoice_number := $1,
         p_branch_id := $2,
         p_shift_id := $3,
         p_warehouse_id := $4,
         p_customer_id := NULL,
         p_salesperson_id := $5,
         p_subtotal := 20,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 0,
         p_bonus_amount := 0,
         p_total := 20,
         p_paid_amount := 20,
         p_payment_method := 'cash',
         p_status := 'completed',
         p_items := $6::jsonb,
         p_order_type := 'takeaway',
         p_table_id := NULL,
         p_order_id := $7
       ) AS r`,
      [invoiceNumber, ids.branchA, ids.shiftA, ids.whA, ids.users.cashier, items, orderId],
    );
    expect(paid.success).toBe(true);
    expect(paid.sale_id).toBeTruthy();

    // Inventory is consumed at kitchen send. Completing payment must not deduct it again.
    expect(await stockQty()).toBe(9);

    const sale = await client.query<{
      cashier_id: string;
      branch_id: string;
      payment_method: string;
      total: string;
      status: string;
    }>(
      `SELECT cashier_id, branch_id, payment_method, total::text, status
         FROM public.sales
        WHERE invoice_number = $1`,
      [invoiceNumber],
    );
    expect(sale.rows).toHaveLength(1);
    expect(sale.rows[0]).toMatchObject({
      cashier_id: ids.users.cashier,
      branch_id: ids.branchA,
      payment_method: 'cash',
      total: '20.00',
      status: 'completed',
    });

    // Shift attribution is represented by the cash movement, not a sales.shift_id column.
    const cashOperation = await client.query<{ created_by: string }>(
      `SELECT created_by
         FROM public.shift_operations
        WHERE shift_id = $1 AND created_by = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [ids.shiftA, ids.users.cashier],
    );
    expect(cashOperation.rows).toHaveLength(1);
    expect(cashOperation.rows[0].created_by).toBe(ids.users.cashier);

    await client.query(
      `UPDATE public.orders SET status = 'completed', payment_status = 'paid'
       WHERE branch_id = $1 AND status IN ('open', 'held')`,
      [ids.branchA],
    );

    const businessDay = await asUser(
      ids.users.super_admin,
      `SELECT public.get_current_business_day($1) AS r`,
      [ids.branchA],
    );
    const businessDate = String((businessDay[0].r as { business_date?: string })?.business_date || '');
    expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const close = await rpc(
      ids.users.cashier,
      `SELECT public.close_shift($1, 20, 'functional cycle close') AS r`,
      [ids.shiftA],
    );
    expect(close.success).toBe(true);
    expect(close.shift_id).toBe(ids.shiftA);

    const shift = await client.query<{ status: string }>(`SELECT status FROM public.shifts WHERE id = $1`, [ids.shiftA]);
    expect(shift.rows[0].status).toBe('closed');

    const dayCloseRows = await asUser(
      ids.users.super_admin,
      `SELECT public.day_close($1,$2::date) AS r`,
      [ids.branchA, businessDate],
    );
    const dayClose = dayCloseRows[0].r as { success?: boolean; already_closed?: boolean };
    expect(dayClose.success).toBe(true);

    const dayReportRows = await asUser(
      ids.users.super_admin,
      `SELECT public.get_day_closing_report($1,$2::date) AS r`,
      [ids.branchA, businessDate],
    );
    const dayReport = dayReportRows[0].r as {
      success?: boolean;
      net_sales?: number;
      cash_sales?: number;
      invoice_count?: number;
    };
    expect(dayReport.success).toBe(true);
    expect(Number(dayReport.net_sales)).toBe(20);
    expect(Number(dayReport.cash_sales)).toBe(20);
    expect(Number(dayReport.invoice_count)).toBeGreaterThanOrEqual(1);

    const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const reconciliationRows = await asUser(
      ids.users.super_admin,
      `SELECT public.get_financial_reconciliation_report($1,$2,$3) AS r`,
      [ids.branchA, from, to],
    );
    const reconciliation = reconciliationRows[0].r as {
      success?: boolean;
      summary?: { cash_difference?: number; bank_difference?: number; mismatch_count?: number };
    };
    expect(reconciliation.success).toBe(true);
    expect(Number(reconciliation.summary?.cash_difference || 0)).toBe(0);
    expect(Number(reconciliation.summary?.bank_difference || 0)).toBe(0);
    expect(Number(reconciliation.summary?.mismatch_count || 0)).toBe(0);

    const treasuryRows = await asUser(
      ids.users.super_admin,
      `SELECT public.get_branch_treasury_day_close_reconciliation($1,10) AS r`,
      [ids.branchA],
    );
    const treasury = treasuryRows[0].r as {
      success?: boolean;
      rows?: Array<{ business_date?: string; cash_sales?: number; net_sales?: number }>;
    };
    expect(treasury.success).toBe(true);
    const treasuryDay = (treasury.rows || []).find((row) => row.business_date === businessDate);
    expect(treasuryDay).toBeTruthy();
    expect(Number(treasuryDay?.cash_sales || 0)).toBe(20);
    expect(Number(treasuryDay?.net_sales || 0)).toBe(20);
  });

  it('fails closed when the same cashier tries to create an order in another branch', async (ctx) => {
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

    const crossBranch = await rpc(
      ids.users.cashier,
      `SELECT public.create_order($1, 'takeaway', NULL, NULL, 1, 'cross branch blocked', $2::jsonb, 20, 0, 'amount', 0, 20, NULL) AS r`,
      [ids.branchB, items],
    );

    expect(crossBranch.success).toBe(false);
    expect(`${crossBranch.error || ''} ${crossBranch.detail || ''}`).toMatch(/BRANCH|ACCESS|PERMISSION|DENIED/i);

    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.orders WHERE notes = 'cross branch blocked'`,
    );
    expect(Number(count.rows[0].count)).toBe(0);
  });
});
