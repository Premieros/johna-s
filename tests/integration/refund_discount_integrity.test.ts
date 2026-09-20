import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RefundResult = {
  success?: boolean;
  error?: string;
  refunded_amount?: number;
  refund_basis?: number;
  fully_refunded?: boolean;
};

describe.skipIf(skip)('refund discount integrity', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;

  const asUser = async (userId: string, sql: string, params: unknown[] = []) => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return result.rows;
  };

  const insertSale = async (args: {
    status: string;
    subtotal: number;
    discount: number;
    total: number;
    paid: number;
  }) => {
    const saleId = randomUUID();
    const itemId = randomUUID();
    await client.query(`SET LOCAL session_replication_role = 'replica'`);
    try {
      await client.query(
        `INSERT INTO public.sales(
           id, invoice_number, branch_id, warehouse_id, cashier_id,
           subtotal, discount_amount, discount_type, tax_amount, total,
           paid_amount, payment_method, status, refunded_amount, order_type
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'amount',0,$8,$9,'cash',$10,0,'takeaway')`,
        [
          saleId, `QA-REF-${randomUUID()}`, ids.branchA, ids.whA, ids.users.branch_manager,
          args.subtotal, args.discount, args.total, args.paid, args.status,
        ],
      );
      await client.query(
        `INSERT INTO public.sale_items(
           id, sale_id, product_id, unit_name, quantity, unit_price,
           discount_amount, bonus_quantity, total, refunded_quantity, refunded_amount
         ) VALUES ($1,$2,$3,'piece',1,$4,0,0,$5,0,0)`,
        [itemId, saleId, ids.prodA, args.subtotal, args.subtotal],
      );
    } finally {
      await client.query(`SET LOCAL session_replication_role = 'origin'`);
    }
    return { saleId, itemId };
  };

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    await client.query(
      `UPDATE public.roles
       SET permissions = COALESCE(permissions, '[]'::jsonb) || '["refunds.approve"]'::jsonb
       WHERE role='branch_manager'
         AND NOT COALESCE(permissions, '[]'::jsonb) ? 'refunds.approve'`,
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('refunds the authoritative net amount after a header discount', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const { saleId, itemId } = await insertSale({
      status: 'completed',
      subtotal: 100,
      discount: 20,
      total: 80,
      paid: 80,
    });

    const rows = await asUser(
      ids.users.branch_manager,
      `SELECT public.process_refund($1,$2::jsonb,$3) AS r`,
      [saleId, JSON.stringify([{ sale_item_id: itemId, quantity: 1 }]), 'QA header discount refund'],
    );
    const result = (rows[0]?.r || {}) as RefundResult;
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(Number(result.refunded_amount)).toBe(80);
    expect(Number(result.refund_basis)).toBe(100);
    expect(result.fully_refunded).toBe(true);

    const state = await client.query<{
      status: string;
      refunded_amount: string;
      refunded_quantity: string;
      item_refunded_amount: string;
    }>(
      `SELECT s.status, s.refunded_amount::text, si.refunded_quantity::text,
              si.refunded_amount::text AS item_refunded_amount
       FROM public.sales s
       JOIN public.sale_items si ON si.sale_id=s.id
       WHERE s.id=$1 AND si.id=$2`,
      [saleId, itemId],
    );
    expect(state.rows[0].status).toBe('returned');
    expect(Number(state.rows[0].refunded_amount)).toBe(80);
    expect(Number(state.rows[0].refunded_quantity)).toBe(1);
    expect(Number(state.rows[0].item_refunded_amount)).toBe(80);
  });

  it('repairs a legacy returned flag with no actual line refund, including a 100%-discount sale', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();
    const { saleId, itemId } = await insertSale({
      status: 'returned',
      subtotal: 100,
      discount: 100,
      total: 0,
      paid: 0,
    });

    const rows = await asUser(
      ids.users.branch_manager,
      `SELECT public.process_refund($1,$2::jsonb,$3) AS r`,
      [saleId, JSON.stringify([{ sale_item_id: itemId, quantity: 1 }]), 'QA legacy return repair'],
    );
    const result = (rows[0]?.r || {}) as RefundResult;
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(Number(result.refunded_amount)).toBe(0);
    expect(Number(result.refund_basis)).toBe(100);
    expect(result.fully_refunded).toBe(true);

    const item = await client.query<{ refunded_quantity: string; refunded_amount: string }>(
      `SELECT refunded_quantity::text, refunded_amount::text
       FROM public.sale_items WHERE id=$1`,
      [itemId],
    );
    expect(Number(item.rows[0].refunded_quantity)).toBe(1);
    expect(Number(item.rows[0].refunded_amount)).toBe(0);
  });

  it('blocks a manual completed-to-returned status flip before line refunds exist', async () => {
    const { saleId } = await insertSale({
      status: 'completed',
      subtotal: 100,
      discount: 0,
      total: 100,
      paid: 100,
    });

    await client.query('SAVEPOINT manual_return_guard');
    let message = '';
    try {
      await client.query(`UPDATE public.sales SET status='returned' WHERE id=$1`, [saleId]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      await client.query('ROLLBACK TO SAVEPOINT manual_return_guard');
    }
    expect(message).toContain('RETURN_STATUS_REQUIRES_REFUND_WORKFLOW');
  });

  it('nets report discounts for full/partial returns and wires both closing RPCs to the helper', async () => {
    const ratio = await client.query<{ full: string; partial: string; legacy_zero: string }>(
      `SELECT
         private.sale_report_remaining_ratio(80,80,'returned')::text AS full,
         private.sale_report_remaining_ratio(80,20,'completed')::text AS partial,
         private.sale_report_remaining_ratio(0,0,'returned')::text AS legacy_zero`,
    );
    expect(Number(ratio.rows[0].full)).toBe(0);
    expect(Number(ratio.rows[0].partial)).toBeCloseTo(0.75, 10);
    expect(Number(ratio.rows[0].legacy_zero)).toBe(0);

    const defs = await client.query<{ proname: string; def: string }>(
      `SELECT p.proname, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname IN ('_build_day_closing_report','get_shift_closing_report')`,
    );
    expect(defs.rows).toHaveLength(2);
    for (const row of defs.rows) {
      expect(row.def, row.proname).toContain('private.sale_report_remaining_ratio');
    }
  });
});
