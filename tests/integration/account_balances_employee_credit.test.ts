import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

type RpcEnvelope = {
  success?: boolean;
  error?: string;
  rows?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
  entries?: Array<Record<string, unknown>>;
};

const rpcResult = (row: Record<string, unknown> | undefined): RpcEnvelope =>
  (row?.result || {}) as RpcEnvelope;

describe.skipIf(!dbUrl)('supplier statements and employee receivables', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    await client.query(`
      UPDATE public.roles
      SET permissions = permissions || '["customers.manage","accounts.view","sales.payment.receive","suppliers.view"]'::jsonb
      WHERE role = 'branch_manager'
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx: { skip?: () => unknown }) => {
      if (!imp) return typeof ctx.skip === 'function' ? ctx.skip() : undefined;
      await fn();
    });

  guarded('links an employee account only inside an accessible branch and reports the existing AR balance', async () => {
    const link = await runAsPersist(
      client,
      ids.users.branch_manager,
      'SELECT public.link_employee_credit_account($1,$2,$3) AS result',
      [ids.custA, ids.users.cashier, ids.branchA],
    );
    expect(link.error).toBeUndefined();
    expect(rpcResult(link.rows[0]).success).toBe(true);

    const denied = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.link_employee_credit_account($1,$2,$3) AS result',
      [ids.custB, ids.users.cashier_b, ids.branchB],
    );
    expect(denied.error).toBeUndefined();
    expect(rpcResult(denied.rows[0])).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });

    const saleId = randomUUID();
    await client.query(
      `INSERT INTO public.sales
        (id, invoice_number, customer_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES ($1,$2,$3,$4,$5,80,0,0,80,0,'credit','completed',now())`,
      [saleId, `EMP-CR-${saleId.slice(0, 8)}`, ids.custA, ids.branchA, ids.whA],
    );

    const balances = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_employee_credit_balances($1) AS result',
      [ids.branchA],
    );
    expect(balances.error).toBeUndefined();
    const payload = rpcResult(balances.rows[0]);
    expect(payload.success).toBe(true);
    const employee = (payload.rows || []).find((row) => row.employee_id === ids.users.cashier);
    expect(employee).toBeTruthy();
    expect(Number(employee?.open_amount)).toBe(80);

    const otherBranch = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_employee_credit_balances($1) AS result',
      [ids.branchB],
    );
    expect(rpcResult(otherBranch.rows[0])).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });

  guarded('reconciles supplier total paid without double-counting recorded payments', async () => {
    const purchaseId = randomUUID();
    const paymentId = randomUUID();
    await client.query(
      `INSERT INTO public.purchases
        (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES ($1,$2,$3,$4,$5,100,0,0,100,50,'cash','completed',now() - interval '1 hour')`,
      [purchaseId, `SUP-ST-${purchaseId.slice(0, 8)}`, ids.suppA, ids.branchA, ids.whA],
    );
    await client.query(
      `INSERT INTO public.supplier_payments
        (id, supplier_id, branch_id, amount, payment_method, purchase_id, reference_number, created_at)
       VALUES ($1,$2,$3,20,'cash',$4,$5,now())`,
      [paymentId, ids.suppA, ids.branchA, purchaseId, `SUP-PAY-${paymentId.slice(0, 8)}`],
    );

    const statement = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_supplier_statement($1,$2) AS result',
      [ids.suppA, ids.branchA],
    );
    expect(statement.error).toBeUndefined();
    const payload = rpcResult(statement.rows[0]);
    expect(payload.success).toBe(true);
    expect(payload.summary).toMatchObject({
      total_purchases: 100,
      total_paid: 50,
      open_balance: 50,
      recorded_payments_total: 20,
      invoice_time_paid: 30,
    });

    const entries = payload.entries || [];
    expect(entries.some((entry) => entry.entry_type === 'invoice_time_payment' && Number(entry.credit) === 30)).toBe(true);
    expect(entries.some((entry) => entry.entry_type === 'payment' && Number(entry.credit) === 20)).toBe(true);
    expect(Number(entries[0]?.running_balance)).toBe(50);

    const denied = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_supplier_statement($1,$2) AS result',
      [ids.suppB, ids.branchB],
    );
    expect(rpcResult(denied.rows[0])).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });
});
