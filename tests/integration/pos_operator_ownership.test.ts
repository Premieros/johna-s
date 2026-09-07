import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  sale_id?: string;
  items_sent_count?: number;
  from_cashier_id?: string;
  to_cashier_id?: string;
  transferred_by?: string;
  open?: boolean;
  shift?: { id?: string };
};

describe.skipIf(skip)('POS operator ownership + transfer release gate', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const productId = randomUUID();
  const unitId = randomUUID();
  const tableId = randomUUID();

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<RpcResult> => {
    const rows = await asUser(userId, sql, params);
    return (rows[0]?.r || {}) as RpcResult;
  };

  const batchQty = async (): Promise<number> => {
    const result = await client.query<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS quantity
         FROM public.inventory_unit_batches
        WHERE unit_id = $1 AND warehouse_id = $2`,
      [unitId, ids.whA],
    );
    return Number(result.rows[0]?.quantity || 0);
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    // Both operators have the same normal POS capabilities. User B intentionally
    // starts without pos.order.transfer so transfer denial is permission-specific.
    await client.query(`
      UPDATE public.roles
      SET permissions = (COALESCE(permissions, '[]'::jsonb) - 'pos.order.transfer')
        || '["pos.view","pos.order.create","pos.order.edit","pos.hold","pos.send_kitchen","pos.payment.take","pos.cancel_order","shifts.open"]'::jsonb
      WHERE role IN ('cashier', 'branch_manager')
    `);

    await client.query(
      `UPDATE public.warehouses
          SET is_default = (id = $1::uuid)
        WHERE branch_id = $2::uuid`,
      [ids.whA, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.dining_tables(id, branch_id, name, capacity, status, is_active)
       VALUES ($1, $2, 'Ownership Table', 4, 'vacant', true)`,
      [tableId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.products(id, name, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, 'Ownership Product', $2, 10, 20, true)`,
      [productId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_units(id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'Ownership Ready Unit', 'ready', $3, 10, 20, true)`,
      [unitId, `OWN-${randomUUID()}`, ids.branchA],
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
    await client.query(`UPDATE public.settings SET tax_enabled = false, tax_rate = 0`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('keeps A/B on one branch shift, enforces ownership, transfers A → B, and preserves attribution', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const shiftForA = await rpc(ids.users.cashier, `SELECT public.get_active_shift($1) AS r`, [ids.branchA]);
    const shiftForB = await rpc(ids.users.branch_manager, `SELECT public.get_active_shift($1) AS r`, [ids.branchA]);
    expect(shiftForA.open).toBe(true);
    expect(shiftForB.open).toBe(true);
    expect(shiftForA.shift?.id).toBe(ids.shiftA);
    expect(shiftForB.shift?.id).toBe(ids.shiftA);

    const item1 = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 9999,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 9999,
    }]);

    // A normal operator cannot create an order in another same-branch user's name.
    const spoofed = await rpc(
      ids.users.cashier,
      `SELECT public.create_order($1, 'dine_in', $2, NULL, 2, 'spoof attempt', $3::jsonb, 9999, 0, 'amount', 0, 9999, $4) AS r`,
      [ids.branchA, tableId, item1, ids.users.branch_manager],
    );
    expect(spoofed.success).toBe(false);
    expect(`${spoofed.error || ''} ${spoofed.detail || ''}`).toContain('ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN');

    const spoofCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.orders WHERE notes = 'spoof attempt'`,
    );
    expect(Number(spoofCount.rows[0].count)).toBe(0);

    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_order($1, 'dine_in', $2, NULL, 2, 'owned by A', $3::jsonb, 9999, 0, 'amount', 0, 9999, NULL) AS r`,
      [ids.branchA, tableId, item1],
    );
    expect(created.success).toBe(true);
    expect(created.order_id).toBeTruthy();
    const orderId = String(created.order_id);

    const ownerRow = await client.query<{ cashier_id: string; status: string }>(
      `SELECT cashier_id, status FROM public.orders WHERE id = $1`,
      [orderId],
    );
    expect(ownerRow.rows[0].cashier_id).toBe(ids.users.cashier);
    expect(ownerRow.rows[0].status).toBe('open');

    // B can see that the table is occupied and resolve A's display name without
    // being granted broad users.view/users.manage access.
    const labelsA = await asUser(
      ids.users.branch_manager,
      `SELECT * FROM public.get_pos_order_operator_labels($1) WHERE order_id = $2`,
      [ids.branchA, orderId],
    );
    expect(labelsA).toHaveLength(1);
    expect(labelsA[0].cashier_id).toBe(ids.users.cashier);
    expect(labelsA[0].operator_name).toBe('Cashier A');

    // A owns the first kitchen send. Inventory crosses the boundary once.
    const stockBefore = await batchQty();
    const firstSend = await rpc(ids.users.cashier, `SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(firstSend.success).toBe(true);
    expect(firstSend.items_sent_count).toBe(1);
    expect(await batchQty()).toBe(stockBefore - 1);

    const firstAttribution = await client.query<{ sent_by: string; created_by: string }>(
      `SELECT s.sent_by, e.created_by
         FROM public.order_kitchen_sends s
         JOIN public.order_kitchen_inventory_events e ON e.order_item_id = s.order_item_id
        WHERE s.order_id = $1
        ORDER BY e.created_at ASC
        LIMIT 1`,
      [orderId],
    );
    expect(firstAttribution.rows[0].sent_by).toBe(ids.users.cashier);
    expect(firstAttribution.rows[0].created_by).toBe(ids.users.cashier);

    // B has edit/cancel/payment capabilities, but none of them override ownership.
    const deniedEdit = await rpc(
      ids.users.branch_manager,
      `SELECT public.update_order($1, 'dine_in', $2, NULL, 2, 'B edit', $3::jsonb, 20, 0, 'amount', 0, 20, 'open') AS r`,
      [orderId, tableId, item1],
    );
    expect(deniedEdit.success).toBe(false);
    expect(`${deniedEdit.error || ''} ${deniedEdit.detail || ''}`).toContain('ORDER_OPERATOR_REQUIRED');

    const deniedCancel = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.set_order_status($1, 'cancelled', 'B cancel attempt')`,
      [orderId],
    );
    expect(deniedCancel.error || '').toContain('ORDER_OPERATOR_REQUIRED');

    const blockedInvoice = `OWN-BLOCK-${randomUUID()}`;
    const deniedPay = await rpc(
      ids.users.branch_manager,
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
         p_order_type := 'dine_in',
         p_table_id := $7,
         p_order_id := $8
       ) AS r`,
      [blockedInvoice, ids.branchA, ids.shiftA, ids.whA, ids.users.branch_manager, item1, tableId, orderId],
    );
    expect(deniedPay.success).toBe(false);
    expect(`${deniedPay.error || ''} ${deniedPay.detail || ''}`).toContain('ORDER_OPERATOR_REQUIRED');
    const blockedSale = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.sales WHERE invoice_number = $1`,
      [blockedInvoice],
    );
    expect(Number(blockedSale.rows[0].count)).toBe(0);

    // A adds one unsent unit. B still cannot send that delta even with
    // pos.send_kitchen because the order is still owned by A.
    const item2 = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 2,
      unit_price: 20,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 40,
    }]);
    const addDelta = await rpc(
      ids.users.cashier,
      `SELECT public.update_order($1, 'dine_in', $2, NULL, 2, 'A added one', $3::jsonb, 40, 0, 'amount', 0, 40, 'open') AS r`,
      [orderId, tableId, item2],
    );
    expect(addDelta.success).toBe(true);
    const stockBeforeDeniedSend = await batchQty();

    const deniedSend = await rpc(ids.users.branch_manager, `SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(deniedSend.success).toBe(false);
    expect(`${deniedSend.error || ''} ${deniedSend.detail || ''}`).toContain('ORDER_OPERATOR_REQUIRED');
    expect(await batchQty()).toBe(stockBeforeDeniedSend);

    const deniedTableTransfer = await rpc(
      ids.users.branch_manager,
      `SELECT public.perform_pos_order_action('transfer_order', $1, $2::jsonb, 'B transfer without permission') AS r`,
      [orderId, JSON.stringify({ target_table_id: randomUUID() })],
    );
    expect(deniedTableTransfer.success).toBe(false);
    expect(deniedTableTransfer.error).toBe('PERMISSION_DENIED');

    const deniedOwnerTransfer = await rpc(
      ids.users.branch_manager,
      `SELECT public.transfer_order_operator($1, $2) AS r`,
      [orderId, ids.users.branch_manager],
    );
    expect(deniedOwnerTransfer.success).toBe(false);
    expect(deniedOwnerTransfer.error).toBe('PERMISSION_DENIED');

    // Grant the independent transfer permission only; no role-name manager bypass
    // and no users.manage requirement participates in this transfer.
    await client.query(`
      UPDATE public.roles
      SET permissions = COALESCE(permissions, '[]'::jsonb) || '["pos.order.transfer"]'::jsonb
      WHERE role = 'branch_manager'
    `);

    const crossBranch = await rpc(
      ids.users.branch_manager,
      `SELECT public.transfer_order_operator($1, $2) AS r`,
      [orderId, ids.users.cashier_b],
    );
    expect(crossBranch.success).toBe(false);
    expect(crossBranch.error).toBe('TARGET_USER_NOT_IN_BRANCH');

    const transferred = await rpc(
      ids.users.branch_manager,
      `SELECT public.transfer_order_operator($1, $2) AS r`,
      [orderId, ids.users.branch_manager],
    );
    expect(transferred.success).toBe(true);
    expect(transferred.from_cashier_id).toBe(ids.users.cashier);
    expect(transferred.to_cashier_id).toBe(ids.users.branch_manager);
    expect(transferred.transferred_by).toBe(ids.users.branch_manager);

    const afterTransfer = await client.query<{ cashier_id: string }>(
      `SELECT cashier_id FROM public.orders WHERE id = $1`,
      [orderId],
    );
    expect(afterTransfer.rows[0].cashier_id).toBe(ids.users.branch_manager);

    const audit = await client.query<{
      user_id: string;
      from_cashier_id: string;
      to_cashier_id: string;
      transferred_by: string;
      transferred_at: string;
    }>(
      `SELECT
         user_id,
         details->>'from_cashier_id' AS from_cashier_id,
         details->>'to_cashier_id' AS to_cashier_id,
         details->>'transferred_by' AS transferred_by,
         details->>'transferred_at' AS transferred_at
       FROM public.audit_log
       WHERE action = 'ORDER_OPERATOR_TRANSFERRED' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].user_id).toBe(ids.users.branch_manager);
    expect(audit.rows[0].from_cashier_id).toBe(ids.users.cashier);
    expect(audit.rows[0].to_cashier_id).toBe(ids.users.branch_manager);
    expect(audit.rows[0].transferred_by).toBe(ids.users.branch_manager);
    expect(audit.rows[0].transferred_at).toBeTruthy();

    // Ownership is immediately inverted: A loses ordinary mutation rights.
    const oldOwnerDenied = await rpc(
      ids.users.cashier,
      `SELECT public.update_order($1, 'dine_in', $2, NULL, 2, 'A after transfer', $3::jsonb, 40, 0, 'amount', 0, 40, 'open') AS r`,
      [orderId, tableId, item2],
    );
    expect(oldOwnerDenied.success).toBe(false);
    expect(`${oldOwnerDenied.error || ''} ${oldOwnerDenied.detail || ''}`).toContain('ORDER_OPERATOR_REQUIRED');

    const labelsB = await asUser(
      ids.users.cashier,
      `SELECT * FROM public.get_pos_order_operator_labels($1) WHERE order_id = $2`,
      [ids.branchA, orderId],
    );
    expect(labelsB).toHaveLength(1);
    expect(labelsB[0].cashier_id).toBe(ids.users.branch_manager);
    expect(labelsB[0].operator_name).toBe('Branch Mgr');

    // B now owns the order and can send the outstanding kitchen delta. The new
    // inventory event and latest send attribution belong to B, while payment is
    // also attributed to B inside the same shared branch shift.
    const secondSend = await rpc(ids.users.branch_manager, `SELECT public.send_to_kitchen($1) AS r`, [orderId]);
    expect(secondSend.success).toBe(true);
    expect(secondSend.items_sent_count).toBe(1);
    expect(await batchQty()).toBe(stockBefore - 2);

    const kitchenAttribution = await client.query<{ created_by: string }>(
      `SELECT created_by
         FROM public.order_kitchen_inventory_events
        WHERE order_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    expect(kitchenAttribution.rows[0].created_by).toBe(ids.users.branch_manager);

    const invoice = `OWN-OK-${randomUUID()}`;
    const paid = await rpc(
      ids.users.branch_manager,
      `SELECT public.process_sale(
         p_invoice_number := $1,
         p_branch_id := $2,
         p_shift_id := $3,
         p_warehouse_id := $4,
         p_customer_id := NULL,
         p_salesperson_id := $5,
         p_subtotal := 40,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 0,
         p_bonus_amount := 0,
         p_total := 40,
         p_paid_amount := 40,
         p_payment_method := 'cash',
         p_status := 'completed',
         p_items := $6::jsonb,
         p_order_type := 'dine_in',
         p_table_id := $7,
         p_order_id := $8
       ) AS r`,
      [invoice, ids.branchA, ids.shiftA, ids.whA, ids.users.branch_manager, item2, tableId, orderId],
    );
    expect(paid.success, JSON.stringify(paid)).toBe(true);
    expect(paid.sale_id).toBeTruthy();
    expect(await batchQty()).toBe(stockBefore - 2);

    const paymentAttribution = await client.query<{ cashier_id: string; created_by: string; order_status: string }>(
      `SELECT s.cashier_id, so.created_by, o.status AS order_status
         FROM public.sales s
         JOIN public.shift_operations so ON so.reference_type = 'sale' AND so.reference_id = s.id
         JOIN public.orders o ON o.id = $2
        WHERE s.id = $1`,
      [paid.sale_id, orderId],
    );
    expect(paymentAttribution.rows[0].cashier_id).toBe(ids.users.branch_manager);
    expect(paymentAttribution.rows[0].created_by).toBe(ids.users.branch_manager);
    expect(paymentAttribution.rows[0].order_status).toBe('completed');
  });

  it('keeps the new transfer/label surfaces authenticated-only and installs ownership triggers', async () => {
    const grants = await client.query<{
      transfer_anon: boolean;
      transfer_auth: boolean;
      labels_anon: boolean;
      labels_auth: boolean;
    }>(`
      SELECT
        has_function_privilege('anon','public.transfer_order_operator(uuid,uuid)','EXECUTE') AS transfer_anon,
        has_function_privilege('authenticated','public.transfer_order_operator(uuid,uuid)','EXECUTE') AS transfer_auth,
        has_function_privilege('anon','public.get_pos_order_operator_labels(uuid)','EXECUTE') AS labels_anon,
        has_function_privilege('authenticated','public.get_pos_order_operator_labels(uuid)','EXECUTE') AS labels_auth
    `);
    expect(grants.rows[0]).toEqual({
      transfer_anon: false,
      transfer_auth: true,
      labels_anon: false,
      labels_auth: true,
    });

    const triggers = await client.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'trg_pos_operator_orders',
          'trg_pos_operator_order_items',
          'trg_pos_operator_tables',
          'trg_pos_operator_kitchen_sends'
        )
      ORDER BY tgname
    `);
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      'trg_pos_operator_kitchen_sends',
      'trg_pos_operator_order_items',
      'trg_pos_operator_orders',
      'trg_pos_operator_tables',
    ]);
  });
});
