import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { attachRawComponentToUnit, rawQtyForUnit } from './componentTestFixtures';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type SplitSaleResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  sale_id?: string;
  split?: boolean;
  payment_count?: number;
};

describe.skipIf(skip)('POS split payment atomicity', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const productId = randomUUID();
  const unitId = randomUUID();

  const batchQty = async (): Promise<number> => rawQtyForUnit(client, unitId, ids.branchA, ids.whA);

  const splitSale = async (invoice: string, payments: unknown[], orderId: string | null = null): Promise<SplitSaleResult> => {
    const items = JSON.stringify([{
      product_id: productId,
      unit_name: 'piece',
      quantity: 1,
      unit_price: 20,
      discount_amount: 0,
      bonus_quantity: 0,
      total: 20,
    }]);

    const result = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.process_sale_split(
         p_invoice_number := $1,
         p_branch_id := $2,
         p_warehouse_id := $3,
         p_customer_id := NULL,
         p_salesperson_id := $4,
         p_subtotal := 20,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 0,
         p_bonus_amount := 0,
         p_total := 20,
         p_payments := $5::jsonb,
         p_status := 'completed',
         p_items := $6::jsonb,
         p_shift_id := $7,
         p_order_type := 'takeaway',
         p_table_id := NULL,
         p_order_id := $8,
         p_guest_count := NULL
       ) AS r`,
      [invoice, ids.branchA, ids.whA, ids.users.cashier, JSON.stringify(payments), items, ids.shiftA, orderId],
    );
    if (result.error) throw new Error(result.error);
    return (result.rows[0]?.r || {}) as SplitSaleResult;
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    // The shared RLS fixture also creates warehouse rows used only for policy
    // probes. Pin the real operational warehouse so send_to_kitchen cannot
    // choose a UUID-tiebroken empty probe warehouse when all rows share the
    // transaction timestamp.
    await client.query(
      `UPDATE public.warehouses SET is_default = (id = $1::uuid) WHERE branch_id = $2::uuid`,
      [ids.whA, ids.branchA],
    );

    await client.query(
      `INSERT INTO public.products
         (id, name, branch_id, cost_price, sale_price, is_active)
       VALUES ($1::uuid, 'Split payment product', $2::uuid, 10, 20, true)`,
      [productId, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_units
         (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1::uuid, $2, 'Split payment ready unit', 'ready', $3::uuid, 10, 20, true)`,
      [unitId, `SPLIT-${randomUUID()}`, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.product_unit_links(product_id, unit_id, quantity)
       VALUES ($1::uuid, $2::uuid, 1)`,
      [productId, unitId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches(unit_id, branch_id, warehouse_id, quantity, unit_cost)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 10, 10)`,
      [unitId, ids.branchA, ids.whA],
    );
    await attachRawComponentToUnit(client, unitId, ids.branchA, ids.whA, 10, 10);
    await client.query(`UPDATE public.settings SET tax_enabled = false, tax_rate = 0`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('records Cash + Card tenders and deducts inventory exactly once', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const before = await batchQty();
    expect(before).toBe(10);

    const invoice = `SPLIT-OK-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const result = await splitSale(invoice, [
      { payment_method: 'cash', amount: 5 },
      { payment_method: 'card', amount: 15 },
    ]);

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.split).toBe(true);
    expect(result.payment_count).toBe(2);
    expect(result.sale_id).toBeTruthy();
    const saleId = String(result.sale_id);

    const sale = await client.query<{ payment_method: string; paid_amount: string; total: string }>(
      `SELECT payment_method, paid_amount::text, total::text
         FROM public.sales WHERE id = $1::uuid`,
      [saleId],
    );
    expect(sale.rows).toHaveLength(1);
    expect(sale.rows[0].payment_method).toBe('split');
    expect(Number(sale.rows[0].paid_amount)).toBe(20);
    expect(Number(sale.rows[0].total)).toBe(20);

    const payments = await client.query<{ payment_method: string; amount: string }>(
      `SELECT payment_method, amount::text
         FROM public.sale_payments
        WHERE sale_id = $1::uuid
        ORDER BY payment_method`,
      [saleId],
    );
    expect(payments.rows.map((row) => [row.payment_method, Number(row.amount)])).toEqual([
      ['card', 15],
      ['cash', 5],
    ]);

    const shiftOps = await client.query<{ payment_method: string; amount: string }>(
      `SELECT payment_method, amount::text
         FROM public.shift_operations
        WHERE shift_id = $1::uuid
          AND operation_type = 'sale'
          AND reference_type = 'sale'
          AND reference_id = $2::uuid
        ORDER BY payment_method`,
      [ids.shiftA, saleId],
    );
    expect(shiftOps.rows.map((row) => [row.payment_method, Number(row.amount)])).toEqual([
      ['card', 15],
      ['cash', 5],
    ]);

    expect(await batchQty()).toBe(9);
  });

  it('settles a kitchen-sent linked order without deducting inventory again', async (ctx) => {
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
    const created = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.create_order($1, 'takeaway', NULL, NULL, NULL, NULL, $2::jsonb, 20, 0, 'amount', 0, 20, $3) AS r`,
      [ids.branchA, items, ids.users.cashier],
    );
    if (created.error) throw new Error(created.error);
    const createdResult = created.rows[0].r as { success?: boolean; order_id?: string };
    expect(createdResult.success, JSON.stringify(createdResult)).toBe(true);
    const orderId = String(createdResult.order_id);
    const beforeSend = await batchQty();

    const sent = await runAsPersist(
      client,
      ids.users.cashier,
      `SELECT public.send_to_kitchen($1) AS r`,
      [orderId],
    );
    if (sent.error) throw new Error(sent.error);
    const sentResult = sent.rows[0].r as { success?: boolean };
    expect(sentResult.success, JSON.stringify(sentResult)).toBe(true);
    expect(await batchQty()).toBe(beforeSend - 1);

    const afterSend = await batchQty();
    const result = await splitSale(
      `SPLIT-KITCHEN-${Date.now()}-${randomUUID().slice(0, 8)}`,
      [{ payment_method: 'cash', amount: 5 }, { payment_method: 'card', amount: 15 }],
      orderId,
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(await batchQty()).toBe(afterSend);
  });

  it('rejects a tender total mismatch without creating a sale or deducting stock', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const before = await batchQty();
    const invoice = `SPLIT-BAD-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const result = await splitSale(invoice, [
      { payment_method: 'cash', amount: 5 },
      { payment_method: 'card', amount: 14 },
    ]);

    expect(result.success).toBe(false);

    const sales = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.sales WHERE invoice_number = $1`,
      [invoice],
    );
    expect(Number(sales.rows[0].count)).toBe(0);
    expect(await batchQty()).toBe(before);
  });
});
