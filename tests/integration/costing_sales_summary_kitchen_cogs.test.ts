import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('costing sales summary kitchen COGS', () => {
  let client: pg.Client;

  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();

  const legacySaleId = randomUUID();
  const kitchenSaleId = randomUUID();
  const overlapSaleId = randomUUID();
  const returnedSaleId = randomUUID();

  const kitchenOrderId = randomUUID();
  const kitchenOrderItemId = randomUUID();
  const overlapOrderId = randomUUID();
  const overlapOrderItemId = randomUUID();
  const returnedOrderId = randomUUID();
  const returnedOrderItemId = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.organizations (id, name, slug)
       VALUES ($1, 'Cost Summary Org', $2)`,
      [orgId, `cost-summary-${orgId.slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches (id, name, organization_id)
       VALUES ($1, 'Cost Summary Branch', $2)`,
      [branchId, orgId],
    );
    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES ($1, 'Cost Summary WH', $2, true)`,
      [warehouseId, branchId],
    );
    await client.query(
      `INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active)
       VALUES ($1, 'Cost Summary Product', $2, 100, 25, true)`,
      [productId, branchId],
    );

    // Legacy sale: COGS is still recorded directly against sale.id.
    await client.query(
      `INSERT INTO public.sales
         (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, 'COST-LEGACY', $2, $3, 200, 0, 30, 230, 230, 'cash', 'completed')`,
      [legacySaleId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.inventory_ledger
         (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_type, reference_id, reference_number)
       VALUES ($1, $2, $3, -2, 25, -50, 'sale', 'sale', $4, 'COST-LEGACY')`,
      [productId, branchId, warehouseId, legacySaleId],
    );

    // Current POS sale: inventory was consumed when sent to kitchen.
    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, order_type, status, inventory_warehouse_id)
       VALUES ($1, 'COST-KITCHEN', $2, 'takeaway', 'completed', $3)`,
      [kitchenOrderId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_items
         (id, order_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
       VALUES ($1, $2, $3, 'piece', 2, 50, 0, 0, 100)`,
      [kitchenOrderItemId, kitchenOrderId, productId],
    );
    await client.query(
      `INSERT INTO public.sales
         (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, 'COST-KITCHEN', $2, $3, 100, 0, 15, 115, 115, 'cash', 'completed')`,
      [kitchenSaleId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events
         (branch_id, warehouse_id, order_id, order_item_id, sent_quantity, voided_quantity, total_cost, settled_sale_id)
       VALUES ($1, $2, $3, $4, 2, 0.5, 30, $5)`,
      [branchId, warehouseId, kitchenOrderId, kitchenOrderItemId, kitchenSaleId],
    );

    // Defensive overlap fixture: if both current and legacy sources exist, the
    // current kitchen event must win instead of double counting both sources.
    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, order_type, status, inventory_warehouse_id)
       VALUES ($1, 'COST-OVERLAP', $2, 'takeaway', 'completed', $3)`,
      [overlapOrderId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_items
         (id, order_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
       VALUES ($1, $2, $3, 'piece', 1, 100, 0, 0, 100)`,
      [overlapOrderItemId, overlapOrderId, productId],
    );
    await client.query(
      `INSERT INTO public.sales
         (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, 'COST-OVERLAP', $2, $3, 100, 0, 15, 115, 115, 'cash', 'completed')`,
      [overlapSaleId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events
         (branch_id, warehouse_id, order_id, order_item_id, sent_quantity, voided_quantity, total_cost, settled_sale_id)
       VALUES ($1, $2, $3, $4, 1, 0, 40, $5)`,
      [branchId, warehouseId, overlapOrderId, overlapOrderItemId, overlapSaleId],
    );
    await client.query(
      `INSERT INTO public.inventory_ledger
         (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_type, reference_id, reference_number)
       VALUES ($1, $2, $3, -1, 999, -999, 'sale', 'sale', $4, 'COST-OVERLAP')`,
      [productId, branchId, warehouseId, overlapSaleId],
    );

    // Returned invoices remain excluded exactly as before.
    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, order_type, status, inventory_warehouse_id)
       VALUES ($1, 'COST-RETURNED', $2, 'takeaway', 'completed', $3)`,
      [returnedOrderId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_items
         (id, order_id, product_id, unit_name, quantity, unit_price, discount_amount, bonus_quantity, total)
       VALUES ($1, $2, $3, 'piece', 1, 100, 0, 0, 100)`,
      [returnedOrderItemId, returnedOrderId, productId],
    );
    await client.query(
      `INSERT INTO public.sales
         (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, 'COST-RETURNED', $2, $3, 100, 0, 0, 100, 100, 'cash', 'returned')`,
      [returnedSaleId, branchId, warehouseId],
    );
    await client.query(
      `INSERT INTO public.order_kitchen_inventory_events
         (branch_id, warehouse_id, order_id, order_item_id, sent_quantity, voided_quantity, total_cost, settled_sale_id)
       VALUES ($1, $2, $3, $4, 1, 0, 100, $5)`,
      [branchId, warehouseId, returnedOrderId, returnedOrderItemId, returnedSaleId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('combines current kitchen-event COGS with legacy fallback without double counting', async () => {
    const result = await client.query<{
      summary: { sales_count: number; net_sales: number; cogs: number; ratio: number };
    }>(
      `SELECT public.get_costing_sales_summary($1, NULL, NULL) AS summary`,
      [branchId],
    );

    const summary = result.rows[0].summary;
    expect(Number(summary.sales_count)).toBe(3);
    expect(Number(summary.net_sales)).toBe(400);

    // 50 legacy + (30 * 1.5/2) kitchen + 40 overlap-kitchen.
    // The overlapping -999 legacy row must not be added.
    expect(Number(summary.cogs)).toBe(112.5);
    expect(Number(summary.ratio)).toBe(28.13);
  });

  it('keeps the costing summary SECURITY INVOKER', async () => {
    const result = await client.query<{ prosecdef: boolean }>(
      `SELECT prosecdef
       FROM pg_proc
       WHERE oid = to_regprocedure('public.get_costing_sales_summary(uuid,date,date)')`,
    );
    expect(result.rows[0]?.prosecdef).toBe(false);
  });


  it('evaluates history bounds once instead of per sale row', async () => {
    const result = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef(
         'public.get_costing_sales_summary(uuid,date,date)'::regprocedure
       ) AS def`,
    );

    const def = result.rows[0]?.def || '';
    expect(def).toContain('history_bounds AS MATERIALIZED');
    expect(def).toContain('scoped_sales AS MATERIALIZED');
    expect(def.match(/history_clamp_from/g) || []).toHaveLength(1);
    expect(def.match(/history_clamp_to/g) || []).toHaveLength(1);
    expect(def).toContain("je.reference_type IN ('sale','fifo_cogs_reconcile')");
    expect(def).toContain('WHEN jc.sale_id IS NOT NULL');
    expect(def).toContain('WHEN kc.sale_id IS NOT NULL');
  });
});
