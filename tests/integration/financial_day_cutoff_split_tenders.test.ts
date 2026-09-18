import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('financial day cutoff + split tender truth', () => {
  let client: pg.Client;
  let ids: RlsIds;
  const businessDate = '2026-09-18';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    await client.query(
      `UPDATE public.branch_settings
       SET business_day_mode='shift_span', business_day_start='09:00'
       WHERE branch_id=$1`,
      [ids.branchA],
    );

    await client.query(
      `UPDATE public.shifts
       SET opened_at='2026-09-18 10:00:00+03',
           closed_at='2026-09-19 04:00:00+03',
           status='closed'
       WHERE id=$1`,
      [ids.shiftA],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('starts at first shift after 09:00 and ends at its actual 04:00 close', async () => {
    const { rows } = await client.query<{ w: Record<string, unknown> }>(
      `SELECT public._resolve_business_day_window($1,$2::date) AS w`,
      [ids.branchA, businessDate],
    );
    const w = rows[0].w;
    expect(String(w.start_at)).toBe('2026-09-18T07:00:00+00:00');
    expect(String(w.end_at)).toBe('2026-09-19T01:00:00+00:00');
    expect(String(w.next_cutoff_at)).toBe('2026-09-19T06:00:00+00:00');
  });

  it('excludes pre-shift expense/purchase and uses sale_payments for split tenders', async () => {
    const baselineQuery = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public._build_day_closing_report($1,$2::date) AS r`,
      [ids.branchA, businessDate],
    );
    const baseline = baselineQuery.rows[0].r;
    const baselineMethods = new Map(
      ((baseline.payment_methods || []) as Array<{ method: string; sales_total: number }>)
        .map((x) => [x.method, Number(x.sales_total || 0)]),
    );

    const expenseBefore = randomUUID();
    const expenseDuring = randomUUID();
    await client.query(
      `INSERT INTO public.expenses
        (id,category,description,amount,branch_id,expense_date,payment_method,status,created_by,created_at)
       VALUES
        ($1,'ops','before first shift',11,$3,$5::date,'cash','posted',$4,'2026-09-18 09:30:00+03'),
        ($2,'ops','inside day',22,$3,$5::date,'cash','posted',$4,'2026-09-18 11:00:00+03')`,
      [expenseBefore, expenseDuring, ids.branchA, ids.users.super_admin, businessDate],
    );

    await client.query(
      `INSERT INTO public.purchases
        (invoice_number,supplier_id,branch_id,warehouse_id,buyer_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES
        ($1,$3,$4,$5,$6,33,0,0,33,33,'cash','completed','2026-09-18 09:40:00+03'),
        ($2,$3,$4,$5,$6,44,0,0,44,44,'cash','completed','2026-09-18 12:00:00+03')`,
      [
        `PRE-${randomUUID()}`, `IN-${randomUUID()}`,
        ids.suppA, ids.branchA, ids.whA, ids.users.super_admin,
      ],
    );

    const saleId = randomUUID();
    await client.query(
      `INSERT INTO public.sales
        (id,invoice_number,branch_id,warehouse_id,cashier_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES ($1,$2,$3,$4,$5,100,0,0,100,100,'split','completed','2026-09-18 13:00:00+03')`,
      [saleId, `SPLIT-${randomUUID()}`, ids.branchA, ids.whA, ids.users.super_admin],
    );
    await client.query(
      `INSERT INTO public.sale_payments(sale_id,branch_id,payment_method,amount,created_by,created_at)
       VALUES ($1,$2,'cash',40,$3,'2026-09-18 13:00:00+03'),
              ($1,$2,'card',60,$3,'2026-09-18 13:00:00+03')`,
      [saleId, ids.branchA, ids.users.super_admin],
    );
    await client.query(
      `INSERT INTO public.shift_operations
        (shift_id,operation_type,amount,payment_method,reference_type,reference_id,created_by,created_at)
       VALUES ($1,'sale',40,'cash','sale',$2,$3,'2026-09-18 13:00:00+03'),
              ($1,'sale',60,'card','sale',$2,$3,'2026-09-18 13:00:00+03')`,
      [ids.shiftA, saleId, ids.users.super_admin],
    );

    const { rows } = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public._build_day_closing_report($1,$2::date) AS r`,
      [ids.branchA, businessDate],
    );
    const r = rows[0].r;
    expect(Number(r.expenses) - Number(baseline.expenses || 0)).toBe(22);
    expect(Number(r.cash_purchases) - Number(baseline.cash_purchases || 0)).toBe(44);

    const expenseDetails = r.expense_details as Array<{ description: string; amount: number }>;
    expect(expenseDetails.some((x) => x.description === 'before first shift')).toBe(false);
    expect(expenseDetails.some((x) => x.description === 'inside day' && Number(x.amount) === 22)).toBe(true);

    const purchaseDetails = r.cash_purchase_details as Array<{ invoice_number: string; cash_outflow: number }>;
    expect(purchaseDetails.some((x) => x.invoice_number.startsWith('PRE-'))).toBe(false);
    expect(purchaseDetails.some((x) => x.invoice_number.startsWith('IN-') && Number(x.cash_outflow) === 44)).toBe(true);

    const methods = r.payment_methods as Array<{ method: string; sales_total: number }>;
    expect(Number(methods.find((x) => x.method === 'cash')?.sales_total || 0) - Number(baselineMethods.get('cash') || 0)).toBe(40);
    expect(Number(methods.find((x) => x.method === 'card')?.sales_total || 0) - Number(baselineMethods.get('card') || 0)).toBe(60);

    const sales = r.sales_details as Array<{ sale_id: string; payments: Array<{ method: string; amount: number }> }>;
    const split = sales.find((x) => x.sale_id === saleId);
    expect(split?.payments).toEqual([
      { method: 'cash', amount: 40 },
      { method: 'card', amount: 60 },
    ]);
  });
});
