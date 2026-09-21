import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('send_to_kitchen + order_kitchen_sends (048)', () => {
  let client: pg.Client;
  const branchId = randomUUID(); const whId = randomUUID(); const prodA = randomUUID(); const prodB = randomUUID(); const unitA = randomUUID(); const unitB = randomUUID(); const cashierId = randomUUID();
  const itemJson = (items: Array<{ product_id: string; quantity: number; notes?: string | null }>) => JSON.stringify(items.map((it) => ({ product_id: it.product_id, unit_name: 'piece', quantity: it.quantity, unit_price: 100, discount_amount: 0, bonus_quantity: 0, total: it.quantity * 100, notes: it.notes ?? null })));
  const makeTable = async (): Promise<string> => { const id = randomUUID(); await client.query(`INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`, [id, `T-${id.slice(0,4)}`, branchId]); return id; };
  async function asUser<T>(fn: () => Promise<T>): Promise<T> { await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]); await client.query(`SET LOCAL ROLE authenticated`); try { return await fn(); } finally { await client.query('RESET ROLE').catch(() => {}); await client.query('RESET app.user_id').catch(() => {}); } }
  async function createOrder(items = itemJson([{ product_id: prodA, quantity: 1 }])) { const t = await makeTable(); return asUser(async () => { const res = await client.query(`SELECT public.create_order($1, 'dine_in', $2, NULL, 2, NULL, $3::jsonb, 100, 0, 'amount', 0, 100, $4) AS r`, [branchId, t, items, cashierId]); return res.rows[0].r; }); }
  async function sendToKitchen(orderId: string) { return asUser(async () => { const res = await client.query(`SELECT public.send_to_kitchen($1) AS r`, [orderId]); return res.rows[0].r; }); }
  async function sendRows(orderId: string): Promise<number> { return (await client.query(`SELECT count(*)::int AS c FROM public.order_kitchen_sends WHERE order_id = $1`, [orderId])).rows[0].c; }
  async function batchQty(unitId = unitA): Promise<number> {
    const r = await client.query<{ quantity: string }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS quantity
         FROM public.inventory_unit_batches
        WHERE unit_id = $1 AND warehouse_id = $2`,
      [unitId, whId],
    );
    return Number(r.rows[0]?.quantity || 0);
  }

  const orgId = randomUUID();
  beforeAll(async () => {
    client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN'); await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, '048 Org', `048-${randomUUID().slice(0,8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchId, '048 Branch', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, '048 WH', branchId]);
    for (const [prod, unit, name] of [[prodA, unitA, 'A'], [prodB, unitB, 'B']] as const) {
      await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`, [prod, `048 Product ${name}`, branchId]);
      await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active) VALUES ($1, $2, $3, 'ready', $4, 50, 100, true)`, [unit, `048-${name}-${randomUUID()}`, `048 Unit ${name}`, branchId]);
      await client.query(`INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`, [prod, unit]);
      await client.query(`INSERT INTO public.inventory_unit_batches (unit_id, branch_id, warehouse_id, quantity, unit_cost) VALUES ($1, $2, $3, 100, 50)`, [unit, branchId, whId]);
    }
    await client.query(`INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, 'cashier', $4, true)`, [cashierId, `k-${randomUUID()}@test.local`, 'Cashier', branchId]);
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'member', true)`, [orgId, cashierId]);
    await client.query(`INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ($1, $2, 0, 'open')`, [branchId, cashierId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });

  it('send_to_kitchen deducts and snapshots every fresh delta with complete ticket data', async () => { const beforeA = await batchQty(unitA); const beforeB = await batchQty(unitB); const created = await createOrder(itemJson([{ product_id: prodA, quantity: 1 }, { product_id: prodB, quantity: 2 }])); expect(created.success).toBe(true); const orderId = created.order_id!; const sent = await sendToKitchen(orderId); expect(sent.success).toBe(true); if (!sent.success) throw new Error(JSON.stringify(sent)); expect(sent.items_sent_count).toBe(2); expect(sent.all_sent).toBe(true); expect(sent.sent).toHaveLength(2); expect(sent.sent.every((row: Record<string, unknown>) => row.station_code && Array.isArray(row.modifiers))).toBe(true); expect(await batchQty(unitA)).toBe(beforeA - 1); expect(await batchQty(unitB)).toBe(beforeB - 2); expect(await sendRows(orderId)).toBe(2); });
  it('a re-send is a stock no-op: zero new rows and no duplicate deduction', async () => { const created = await createOrder(); expect(created.success).toBe(true); const orderId = created.order_id!; const first = await sendToKitchen(orderId); expect(first.items_sent_count).toBe(1); const afterFirst = await batchQty(); const second = await sendToKitchen(orderId); expect(second.success).toBe(true); expect(second.items_sent_count).toBe(0); expect(second.all_sent).toBe(true); expect(await batchQty()).toBe(afterFirst); expect(await sendRows(orderId)).toBe(1); const r = await client.query(`SELECT count(*)::int AS c FROM (SELECT order_item_id, count(*) AS n FROM public.order_kitchen_sends WHERE order_id = $1 GROUP BY order_item_id HAVING count(*) > 1) dup`, [orderId]); expect(r.rows[0].c).toBe(0); });
  it('update_order preserves line ids: a same-cart re-persist does not re-send (069)', async () => { const created = await createOrder(); expect(created.success).toBe(true); const orderId = created.order_id!; const first = await sendToKitchen(orderId); expect(first.items_sent_count).toBe(1); expect(await sendRows(orderId)).toBe(1); await asUser(async () => { const res = await client.query(`SELECT public.update_order($1, 'dine_in', NULL, NULL, 2, NULL, $2::jsonb, 100, 0, 'amount', 0, 100, 'held') AS r`, [orderId, itemJson([{ product_id: prodA, quantity: 1 }])]); expect(res.rows[0].r.success).toBe(true); }); const second = await sendToKitchen(orderId); expect(second.success).toBe(true); expect(second.items_sent_count).toBe(0); expect(second.all_sent).toBe(true); expect(await sendRows(orderId)).toBe(1); const lines = await client.query(`SELECT count(*)::int AS c, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.order_kitchen_sends s WHERE s.order_item_id = public.order_items.id))::int AS sent FROM public.order_items WHERE order_id = $1`, [orderId]); expect(lines.rows[0].c).toBe(1); expect(lines.rows[0].sent).toBe(1); });
  it('positive delta on duplicate sent product lines with different notes never requires approval', async () => {
    const before = await batchQty(unitA);
    const created = await createOrder(itemJson([
      { product_id: prodA, quantity: 1, notes: 'Sprite' },
      { product_id: prodA, quantity: 2, notes: null },
    ]));
    expect(created.success).toBe(true);
    const orderId = created.order_id!;

    const firstSend = await sendToKitchen(orderId);
    expect(firstSend.success).toBe(true);
    expect(firstSend.items_sent_count).toBe(2);
    expect(await batchQty(unitA)).toBe(before - 3);

    // Deliberately reverse the duplicate lines when re-persisting. Before the
    // note-identity fix, update_order could match the wrong sent row and treat
    // this positive-only change as a reduction that needed manager approval.
    const updatedItems = itemJson([
      { product_id: prodA, quantity: 4, notes: null },
      { product_id: prodA, quantity: 1, notes: 'Sprite' },
    ]);
    const update = await asUser(async () => client.query(
      `SELECT public.update_order($1, 'dine_in', NULL, NULL, 2, NULL, $2::jsonb, 500, 0, 'amount', 0, 500, 'open') AS r`,
      [orderId, updatedItems],
    ));
    expect(update.rows[0].r.success).toBe(true);

    const delta = await sendToKitchen(orderId);
    expect(delta.success).toBe(true);
    expect(delta.items_sent_count).toBe(1);
    expect(Number(delta.sent[0].quantity)).toBe(2);
    expect(await batchQty(unitA)).toBe(before - 5);

    const lines = await client.query(
      `SELECT oi.notes, oi.quantity, COALESCE(s.sent_quantity,0) sent_quantity
         FROM public.order_items oi
         LEFT JOIN public.order_kitchen_sends s ON s.order_item_id=oi.id
        WHERE oi.order_id=$1
        ORDER BY oi.notes NULLS FIRST`,
      [orderId],
    );
    expect(lines.rows).toHaveLength(2);
    const plain = lines.rows.find((row: { notes: string | null }) => row.notes === null);
    const sprite = lines.rows.find((row: { notes: string | null }) => row.notes === 'Sprite');
    expect(Number(plain.quantity)).toBe(4);
    expect(Number(plain.sent_quantity)).toBe(4);
    expect(Number(sprite.quantity)).toBe(1);
    expect(Number(sprite.sent_quantity)).toBe(1);
  });

  it('resume + add item + send + payment: only the new line reaches KDS and payment never deducts again (ERP-01)', async () => { const beforeA = await batchQty(unitA); const beforeB = await batchQty(unitB); const created = await createOrder(); expect(created.success).toBe(true); const orderId = created.order_id!; await sendToKitchen(orderId); expect(await batchQty(unitA)).toBe(beforeA - 1); expect(await sendRows(orderId)).toBe(1); const cart = itemJson([{ product_id: prodA, quantity: 1 }, { product_id: prodB, quantity: 1 }]); await asUser(async () => { const res = await client.query(`SELECT public.update_order($1, 'dine_in', NULL, NULL, 2, NULL, $2::jsonb, 200, 0, 'amount', 0, 200, 'held') AS r`, [orderId, cart]); expect(res.rows[0].r.success).toBe(true); }); const sent = await sendToKitchen(orderId); expect(sent.success).toBe(true); if (!sent.success) throw new Error(JSON.stringify(sent)); expect(sent.items_sent_count).toBe(1); expect(sent.sent).toHaveLength(1); expect(sent.sent![0].product_id).toBe(prodB); expect(await batchQty(unitB)).toBe(beforeB - 1); expect(await sendRows(orderId)).toBe(2); const beforePaymentA = await batchQty(unitA); const beforePaymentB = await batchQty(unitB); await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]); await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]); const sale = await asUser(async () => client.query(`SELECT public.process_sale($1, $2, $3, NULL, NULL, 200, 0, 'amount', 0, 0, 200, 200, 'cash', 'completed', $4::jsonb, NULL, 'takeaway', NULL, $5) AS r`, [`INV-${randomUUID()}`, branchId, whId, cart, orderId])); expect(sale.rows[0].r.success).toBe(true); if (!sale.rows[0].r.success) throw new Error(JSON.stringify(sale.rows[0].r)); expect(await batchQty(unitA)).toBe(beforePaymentA); expect(await batchQty(unitB)).toBe(beforePaymentB); const saleLines = await client.query(`SELECT count(*)::int AS c FROM public.sale_items WHERE sale_id = $1`, [sale.rows[0].r.sale_id]); expect(saleLines.rows[0].c).toBe(2); const closed = await sendToKitchen(orderId); expect(closed.success).toBe(false); expect(closed.error).toBe('ORDER_NOT_EDITABLE'); });

  it('cashier without pos.void requires approval, blocks bypass, and restores the exact sent quantity', async () => {
    const beforeRole = await client.query<{ permissions: unknown }>(
      `SELECT permissions FROM public.roles WHERE role='cashier'`,
    );
    const originalPermissions = beforeRole.rows[0]?.permissions;

    // This case deliberately models a user who does NOT own the direct Void
    // capability. CI role seeds can change over time, so make that precondition
    // explicit instead of relying on the default cashier role.
    await client.query(
      `UPDATE public.roles
          SET permissions = COALESCE(permissions, '[]'::jsonb) - 'pos.void'
        WHERE role='cashier'`,
    );

    try {
      const created = await createOrder(itemJson([{ product_id: prodA, quantity: 2 }]));
      expect(created.success).toBe(true);
      const orderId = created.order_id!;
      const sent = await sendToKitchen(orderId);
      expect(sent.success).toBe(true);
      expect(sent.items_sent_count).toBe(1);

      const stockAfterSend = await batchQty();
      expect(stockAfterSend).toBeGreaterThan(0);

      const first = await asUser(async () => client.query(
        `SELECT public.cancel_sent_order_item($1, $2, 1, 'customer changed mind') AS r`,
        [orderId, prodA],
      ));
      const pending = first.rows[0].r as { success: boolean; error?: string; request_id?: string };
      expect(pending.success).toBe(false);
      expect(pending.error).toBe('MANAGER_APPROVAL_REQUIRED');
      expect(pending.request_id).toBeTruthy();
      expect(await batchQty()).toBe(stockAfterSend);

      // A user cannot bypass the approval RPC by shrinking an already-sent
      // cart through update_order; the sent-line mutation trigger still blocks it.
      const bypass = await asUser(async () => client.query(
        `SELECT public.update_order($1, 'dine_in', NULL, NULL, 2, NULL, $2::jsonb, 100, 0, 'amount', 0, 100, 'held') AS r`,
        [orderId, itemJson([{ product_id: prodA, quantity: 1 }])],
      ));
      expect(bypass.rows[0].r.success).toBe(false);
      expect(String(bypass.rows[0].r.detail || '')).toContain('SENT_ITEM_APPROVAL_REQUIRED');
      expect(await batchQty()).toBe(stockAfterSend);

      // Simulate the manager decision itself as the CI session owner. The
      // approval RPC is tested separately; this test focuses on the cancellation
      // boundary and inventory invariant.
      await client.query(
        `UPDATE public.approval_requests SET status='approved', decided_at=now() WHERE id=$1`,
        [pending.request_id],
      );

      const approved = await asUser(async () => client.query(
        `SELECT public.cancel_sent_order_item($1, $2, 1, 'customer changed mind') AS r`,
        [orderId, prodA],
      ));
      const result = approved.rows[0].r as { success: boolean; remaining_quantity?: number; inventory_changed?: boolean };
      expect(result.success).toBe(true);
      expect(Number(result.remaining_quantity)).toBe(1);
      expect(result.inventory_changed).toBe(true);
      expect(await batchQty()).toBe(stockAfterSend + 1);

      const line = await client.query(`SELECT quantity FROM public.order_items WHERE order_id=$1 AND product_id=$2`, [orderId, prodA]);
      expect(Number(line.rows[0].quantity)).toBe(1);
      const voids = await client.query(`SELECT quantity, reason FROM public.order_kitchen_voids WHERE order_id=$1 AND product_id=$2`, [orderId, prodA]);
      expect(voids.rows).toHaveLength(1);
      expect(Number(voids.rows[0].quantity)).toBe(1);
      const approval = await client.query(`SELECT status FROM public.approval_requests WHERE id=$1`, [pending.request_id]);
      expect(approval.rows[0].status).toBe('consumed');

      const resend = await sendToKitchen(orderId);
      expect(resend.success).toBe(true);
      expect(resend.items_sent_count).toBe(0);
      expect(await batchQty()).toBe(stockAfterSend + 1);

      const addBack = await asUser(async () => client.query(
        `SELECT public.update_order($1, 'dine_in', NULL, NULL, 2, NULL, $2::jsonb, 200, 0, 'amount', 0, 200, 'held') AS r`,
        [orderId, itemJson([{ product_id: prodA, quantity: 2 }])],
      ));
      expect(addBack.rows[0].r.success).toBe(true);
      const positiveDelta = await sendToKitchen(orderId);
      expect(positiveDelta.success).toBe(true);
      expect(positiveDelta.items_sent_count).toBe(1);
      expect(Number(positiveDelta.sent[0].quantity)).toBe(1);
      expect(await batchQty()).toBe(stockAfterSend);
    } finally {
      await client.query(
        `UPDATE public.roles SET permissions=$1::jsonb WHERE role='cashier'`,
        [JSON.stringify(originalPermissions ?? [])],
      );
    }
  });

  it('a user with pos.void can void a sent item directly without manager approval', async () => {
    const beforeRole = await client.query<{ permissions: unknown }>(
      `SELECT permissions FROM public.roles WHERE role='cashier'`,
    );
    const originalPermissions = beforeRole.rows[0]?.permissions;

    await client.query(
      `UPDATE public.roles
          SET permissions = CASE
            WHEN jsonb_typeof(COALESCE(permissions, '[]'::jsonb)) = 'array'
              THEN COALESCE(permissions, '[]'::jsonb) || '["pos.void"]'::jsonb
            ELSE COALESCE(permissions, '{}'::jsonb) || '{"pos.void": true}'::jsonb
          END
        WHERE role='cashier'`,
    );

    try {
      const created = await createOrder(itemJson([{ product_id: prodA, quantity: 1 }]));
      expect(created.success).toBe(true);
      const orderId = created.order_id!;
      const sent = await sendToKitchen(orderId);
      expect(sent.success).toBe(true);
      expect(sent.items_sent_count).toBe(1);
      const stockAfterSend = await batchQty();

      const line = await client.query<{ id: string }>(
        `SELECT id FROM public.order_items WHERE order_id=$1 AND product_id=$2 LIMIT 1`,
        [orderId, prodA],
      );
      const orderItemId = line.rows[0]?.id;
      expect(orderItemId).toBeTruthy();

      const approvalsBefore = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c
           FROM public.approval_requests
          WHERE requester_id=$1
            AND action_type='cancel_sent_item'
            AND entity_id=$2`,
        [cashierId, orderItemId],
      );

      const direct = await asUser(async () => client.query(
        `SELECT public.cancel_sent_order_item_exact($1, $2, 1, 'customer changed mind') AS r`,
        [orderId, orderItemId],
      ));
      const result = direct.rows[0].r as {
        success: boolean;
        error?: string;
        remaining_quantity?: number;
        inventory_changed?: boolean;
      };
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(result.error).toBeUndefined();
      expect(Number(result.remaining_quantity)).toBe(0);
      expect(result.inventory_changed).toBe(true);
      expect(await batchQty()).toBe(stockAfterSend + 1);

      const approvalsAfter = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c
           FROM public.approval_requests
          WHERE requester_id=$1
            AND action_type='cancel_sent_item'
            AND entity_id=$2`,
        [cashierId, orderItemId],
      );
      expect(approvalsAfter.rows[0].c).toBe(approvalsBefore.rows[0].c);

      const voidRow = await client.query(
        `SELECT quantity, reason
           FROM public.order_kitchen_voids
          WHERE order_id=$1 AND order_item_id=$2`,
        [orderId, orderItemId],
      );
      expect(voidRow.rows).toHaveLength(1);
      expect(Number(voidRow.rows[0].quantity)).toBe(1);
    } finally {
      await client.query(
        `UPDATE public.roles SET permissions=$1::jsonb WHERE role='cashier'`,
        [JSON.stringify(originalPermissions ?? [])],
      );
    }
  });

  it('payment cannot bypass kitchen send or deduct an unsent linked order', async () => {
    const cart = itemJson([{ product_id: prodA, quantity: 1 }]);
    const created = await createOrder(cart);
    expect(created.success).toBe(true);
    const before = await batchQty();
    const sale = await asUser(async () => client.query(
      `SELECT public.process_sale($1, $2, $3, NULL, NULL, 100, 0, 'amount', 0, 0, 100, 100, 'cash', 'completed', $4::jsonb, NULL, 'takeaway', NULL, $5) AS r`,
      [`INV-${randomUUID()}`, branchId, whId, cart, created.order_id],
    ));
    expect(sale.rows[0].r.success).toBe(false);
    expect(sale.rows[0].r.error).toBe('ORDER_NOT_FULLY_SENT');
    expect(await batchQty()).toBe(before);
    const order = await client.query(`SELECT status FROM public.orders WHERE id=$1`, [created.order_id]);
    expect(order.rows[0].status).toBe('open');
  });

  it('insufficient stock blocks the whole multi-line send atomically and identifies the item', async () => {
    const beforeA = await batchQty(unitA);
    const created = await createOrder(itemJson([{ product_id: prodA, quantity: 1 }, { product_id: prodB, quantity: 10000 }]));
    expect(created.success).toBe(true);
    const result = await sendToKitchen(created.order_id!);
    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_STOCK');
    expect(result.product_id).toBe(prodB);
    expect(await batchQty(unitA)).toBe(beforeA);
    expect(await sendRows(created.order_id!)).toBe(0);
    const events = await client.query(`SELECT count(*)::int AS c FROM public.order_kitchen_inventory_events WHERE order_id=$1`, [created.order_id]);
    expect(events.rows[0].c).toBe(0);
  });

  it('send_to_kitchen rejects a completed order (ORDER_NOT_EDITABLE)', async () => { const created = await createOrder(); expect(created.success).toBe(true); await client.query(`UPDATE public.orders SET status = 'completed' WHERE id = $1`, [created.order_id]); const sent = await sendToKitchen(created.order_id!); expect(sent.success).toBe(false); expect(sent.error).toBe('ORDER_NOT_EDITABLE'); });
  it('set_order_status cannot reopen a completed order (H4 ORDER_CLOSED)', async () => { const created = await createOrder(); expect(created.success).toBe(true); await client.query(`UPDATE public.orders SET status = 'completed' WHERE id = $1`, [created.order_id]); const res = await asUser(async () => client.query(`SELECT public.set_order_status($1, 'open') AS r`, [created.order_id])); expect(res.rows[0].r.success).toBe(false); expect(res.rows[0].r.error).toBe('ORDER_CLOSED'); const order = await client.query(`SELECT status FROM public.orders WHERE id = $1`, [created.order_id]); expect(order.rows[0].status).toBe('completed'); });
  it('order_kitchen_sends is readable under RLS within the caller branch', async () => { const created = await createOrder(); expect(created.success).toBe(true); await sendToKitchen(created.order_id!); const r = await asUser(async () => client.query(`SELECT count(*)::int AS c FROM public.order_kitchen_sends WHERE order_id = $1`, [created.order_id])); expect(r.rows[0].c).toBe(1); });
  it('pos.void alone can partially void a sent table item owned by another operator in the same branch', async () => {
    const beforeRole = await client.query<{ permissions: unknown }>(
      `SELECT permissions FROM public.roles WHERE role='cashier'`,
    );
    const originalPermissions = beforeRole.rows[0]?.permissions;
    const otherOperatorId = randomUUID();

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Other Table Operator', 'cashier', $3, true)`,
      [otherOperatorId, `other-${randomUUID()}@test.local`, branchId],
    );

    try {
      const created = await createOrder(itemJson([{ product_id: prodA, quantity: 2 }]));
      expect(created.success).toBe(true);
      const orderId = created.order_id!;

      const sent = await sendToKitchen(orderId);
      expect(sent.success).toBe(true);
      expect(sent.items_sent_count).toBe(1);
      const stockAfterSend = await batchQty();

      const line = await client.query<{ id: string }>(
        `SELECT id FROM public.order_items WHERE order_id=$1 AND product_id=$2 LIMIT 1`,
        [orderId, prodA],
      );
      const orderItemId = line.rows[0]?.id;
      expect(orderItemId).toBeTruthy();

      // Fixture-only ownership change: the sent order now belongs to another operator.
      await client.query(
        `UPDATE public.orders SET cashier_id=$1 WHERE id=$2`,
        [otherOperatorId, orderId],
      );

      // The executor deliberately loses every permission that composes the
      // generic "manage other POS orders" bundle, plus send/edit authority.
      // pos.void must remain sufficient only for the controlled Void RPC.
      await client.query(
        `UPDATE public.roles
            SET permissions = (
              COALESCE(permissions, '[]'::jsonb)
              - 'pos.order.edit'
              - 'pos.order.transfer'
              - 'users.manage'
              - 'pos.send_kitchen'
              - 'approvals.review'
            ) || '["pos.view","pos.void"]'::jsonb
          WHERE role='cashier'`,
      );

      const manageOthers = await asUser(async () => client.query<{ allowed: boolean }>(
        `SELECT public.can_manage_other_pos_orders() AS allowed`,
      ));
      expect(manageOthers.rows[0].allowed).toBe(false);

      const voided = await asUser(async () => client.query(
        `SELECT public.cancel_sent_order_item_exact($1,$2,1,'customer cancelled item') AS r`,
        [orderId, orderItemId],
      ));
      expect(voided.rows[0].r.success, JSON.stringify(voided.rows[0].r)).toBe(true);
      expect(await batchQty()).toBe(stockAfterSend + 1);

      const sends = await client.query<{ c: number; qty: string }>(
        `SELECT count(*)::int AS c, COALESCE(max(sent_quantity),0)::text AS qty
           FROM public.order_kitchen_sends
          WHERE order_item_id=$1`,
        [orderItemId],
      );
      expect(Number(sends.rows[0].qty)).toBe(1);

      const remainingLine = await client.query<{ quantity: string }>(
        `SELECT quantity::text AS quantity FROM public.order_items WHERE id=$1`,
        [orderItemId],
      );
      expect(Number(remainingLine.rows[0].quantity)).toBe(1);

      const audit = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c
           FROM public.audit_log
          WHERE action='SENT_ITEM_VOIDED'
            AND entity_id=$1
            AND user_id=$2`,
        [orderItemId, cashierId],
      );
      expect(audit.rows[0].c).toBe(1);
    } finally {
      await client.query(
        `UPDATE public.roles SET permissions=$1::jsonb WHERE role='cashier'`,
        [JSON.stringify(originalPermissions ?? [])],
      );
    }
  });

});