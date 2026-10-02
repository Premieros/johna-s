import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('supplier payment allocation ledger', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const supplierId = randomUUID();
  const paymentId = randomUUID();
  const p1 = randomUUID();
  const p2 = randomUUID();
  const p3 = randomUUID();
  const p4 = randomUUID();
  const legacyPurchaseId = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await q(`INSERT INTO public.branches (id,name) VALUES ($1,'Supplier Allocation QA')`, [branchId]);
    await q(`INSERT INTO public.suppliers (id,name,branch_id) VALUES ($1,'Supplier Allocation QA',$2)`, [supplierId, branchId]);

    await q(
      `INSERT INTO public.purchases
       (id,invoice_number,supplier_id,branch_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,returned_amount)
       VALUES
       ($1,'ALLOC-P1',$3,$4,100,0,0,100,0,'credit','completed',0),
       ($2,'ALLOC-P2',$3,$4,50,0,0,50,0,'credit','completed',0)`,
      [p1, p2, supplierId, branchId],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('captures one managed payment allocated across multiple invoices without changing payment truth', async () => {
    await q(
      `INSERT INTO public.supplier_payments
       (id,supplier_id,branch_id,amount,payment_method,reference_number)
       VALUES ($1,$2,$3,150,'cash','ALLOC-PAY-1')`,
      [paymentId, supplierId, branchId],
    );

    await q(`UPDATE public.purchases SET paid_amount=100 WHERE id=$1`, [p1]);
    await q(`UPDATE public.purchases SET paid_amount=50 WHERE id=$1`, [p2]);
    await q(`SELECT set_config('app.current_supplier_payment_id','',true)`);

    const payment = await q<{ amount: string; allocation_mode: string }>(
      `SELECT amount::text,allocation_mode FROM public.supplier_payments WHERE id=$1`,
      [paymentId],
    );
    expect(payment).toEqual([{ amount: '150.00', allocation_mode: 'managed' }]);

    const allocations = await q<{ purchase_id: string; applied: string }>(
      `SELECT purchase_id,
              ROUND(SUM(CASE WHEN event_type='apply' THEN amount ELSE -amount END),2)::text AS applied
       FROM public.supplier_payment_allocations
       WHERE supplier_payment_id=$1
       GROUP BY purchase_id`,
      [paymentId],
    );

    expect(Object.fromEntries(allocations.map((r) => [r.purchase_id, Number(r.applied)]))).toEqual({
      [p1]: 100,
      [p2]: 50,
    });
  });

  it('releases excess allocation on return and keeps the payment as unapplied credit', async () => {
    await q(`UPDATE public.purchases SET returned_amount=20 WHERE id=$1`, [p2]);

    const purchase = await q<{ returned_amount: string; paid_amount: string }>(
      `SELECT returned_amount::text,paid_amount::text FROM public.purchases WHERE id=$1`,
      [p2],
    );
    expect(purchase).toEqual([{ returned_amount: '20.00', paid_amount: '30.00' }]);

    const events = await q<{ event_type: string; amount: string; reason_code: string }>(
      `SELECT event_type,amount::text,reason_code
       FROM public.supplier_payment_allocations
       WHERE purchase_id=$1
       ORDER BY created_at,id`,
      [p2],
    );
    expect(events.map((e) => [e.event_type, Number(e.amount), e.reason_code])).toEqual([
      ['apply', 50, 'payment_apply'],
      ['unapply', 20, 'purchase_return_release'],
    ]);

    const unapplied = await q<{ amount: string }>(
      `SELECT ROUND(sp.amount-public._supplier_payment_net_allocated(sp.id),2)::text AS amount
       FROM public.supplier_payments sp WHERE sp.id=$1`,
      [paymentId],
    );
    expect(Number(unapplied[0].amount)).toBe(20);
  });

  it('auto-applies released managed credit to later credit invoices', async () => {
    await q(
      `INSERT INTO public.purchases
       (id,invoice_number,supplier_id,branch_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,returned_amount)
       VALUES ($1,'ALLOC-P3',$2,$3,15,0,0,15,0,'credit','completed',0)`,
      [p3, supplierId, branchId],
    );

    const third = await q<{ paid_amount: string }>(
      `SELECT paid_amount::text FROM public.purchases WHERE id=$1`,
      [p3],
    );
    expect(Number(third[0].paid_amount)).toBe(15);

    await q(
      `INSERT INTO public.purchases
       (id,invoice_number,supplier_id,branch_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,returned_amount)
       VALUES ($1,'ALLOC-P4',$2,$3,5,0,0,5,0,'credit','completed',0)`,
      [p4, supplierId, branchId],
    );

    const fourth = await q<{ paid_amount: string }>(
      `SELECT paid_amount::text FROM public.purchases WHERE id=$1`,
      [p4],
    );
    expect(Number(fourth[0].paid_amount)).toBe(5);

    const unapplied = await q<{ amount: string }>(
      `SELECT ROUND(sp.amount-public._supplier_payment_net_allocated(sp.id),2)::text AS amount
       FROM public.supplier_payments sp WHERE sp.id=$1`,
      [paymentId],
    );
    expect(Number(unapplied[0].amount)).toBe(0);
  });

  it('fails closed when a legacy paid invoice would lose untraceable settlement', async () => {
    await q(
      `INSERT INTO public.purchases
       (id,invoice_number,supplier_id,branch_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,returned_amount)
       VALUES ($1,'ALLOC-LEGACY',$2,$3,50,0,0,50,40,'credit','completed',0)`,
      [legacyPurchaseId, supplierId, branchId],
    );

    await client.query('SAVEPOINT legacy_paid_guard');
    let message = '';
    try {
      await q(`UPDATE public.purchases SET returned_amount=30 WHERE id=$1`, [legacyPurchaseId]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      await client.query('ROLLBACK TO SAVEPOINT legacy_paid_guard');
    }

    expect(message).toContain('LEGACY_PAID_PURCHASE_REQUIRES_RECONCILIATION');

    const legacy = await q<{ paid_amount: string; returned_amount: string }>(
      `SELECT paid_amount::text,returned_amount::text FROM public.purchases WHERE id=$1`,
      [legacyPurchaseId],
    );
    expect(legacy).toEqual([{ paid_amount: '40.00', returned_amount: '0.00' }]);
  });
});
