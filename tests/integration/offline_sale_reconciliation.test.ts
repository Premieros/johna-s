import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type ReconcileResult = {
  success?: boolean;
  error?: string;
  reconciled?: boolean;
  sale_id?: string;
  invoice_number?: string;
};

describe.skipIf(skip)('offline sale reconciliation boundary', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const cashier = randomUUID();
  const saleId = randomUUID();
  const invoice = `INV-OFF-${Date.now()}-${randomUUID()}`;

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function reconcile(params: {
    invoiceNumber?: string;
    branchId?: string;
    paidAmount?: number;
    paymentMethod?: string;
  } = {}): Promise<ReconcileResult> {
    const result = await client.query<{ value: ReconcileResult }>(
      `SELECT public.reconcile_offline_sale($1::text, $2::uuid, $3::numeric, $4::text) AS value`,
      [
        params.invoiceNumber ?? invoice,
        params.branchId ?? branchA,
        params.paidAmount ?? 100,
        params.paymentMethod ?? 'cash',
      ],
    );
    return result.rows[0]?.value ?? {};
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'Offline Reconcile A'), ($2, 'Offline Reconcile B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Offline Cashier', 'cashier', $3, true)`,
      [cashier, `${randomUUID()}@test.local`, branchA],
    );
    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN jsonb_typeof(COALESCE(permissions, '[]'::jsonb)) = 'array'
           THEN (COALESCE(permissions, '[]'::jsonb) - 'pos.payment.take') || '["pos.payment.take"]'::jsonb
         ELSE jsonb_set(COALESCE(permissions, '{}'::jsonb), '{pos.payment.take}', 'true'::jsonb, true)
       END,
       updated_at = now()
       WHERE role = 'cashier'`,
    );
    await client.query(
      `INSERT INTO public.sales (id, invoice_number, branch_id, cashier_id, total, paid_amount, payment_method)
       VALUES ($1, $2, $3, $4, 100, 100, 'cash')`,
      [saleId, invoice, branchA, cashier],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('confirms only the exact already-committed offline financial action', async () => {
    await asUser(cashier, async () => {
      const result = await reconcile();
      expect(result.success).toBe(true);
      expect(result.reconciled).toBe(true);
      expect(result.sale_id).toBe(saleId);
      expect(result.invoice_number).toBe(invoice);
    });
  });

  it('rejects settlement collisions instead of acknowledging the wrong sale', async () => {
    await asUser(cashier, async () => {
      const wrongAmount = await reconcile({ paidAmount: 99 });
      expect(wrongAmount.success).toBe(false);
      expect(wrongAmount.error).toBe('OFFLINE_RECONCILIATION_CONFLICT');

      const wrongMethod = await reconcile({ paymentMethod: 'card' });
      expect(wrongMethod.success).toBe(false);
      expect(wrongMethod.error).toBe('OFFLINE_RECONCILIATION_CONFLICT');
    });
  });

  it('rejects ordinary online invoice numbers and inaccessible branches', async () => {
    await asUser(cashier, async () => {
      const online = await reconcile({ invoiceNumber: `INV-${randomUUID()}` });
      expect(online.success).toBe(false);
      expect(online.error).toBe('INVALID_OFFLINE_INVOICE');

      const otherBranch = await reconcile({ branchId: branchB });
      expect(otherBranch.success).toBe(false);
      expect(otherBranch.error).toBe('BRANCH_MISMATCH');
    });
  });

  it('enforces one sale per branch/invoice while allowing another branch to use the same document number', async () => {
    const sp = `sp_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${sp}`);
    let duplicateError = '';
    try {
      await client.query(
        `INSERT INTO public.sales (invoice_number, branch_id, cashier_id, total, paid_amount, payment_method)
         VALUES ($1, $2, $3, 100, 100, 'cash')`,
        [invoice, branchA, cashier],
      );
    } catch (error) {
      duplicateError = String((error as { message?: string })?.message ?? error);
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    expect(duplicateError).toMatch(/duplicate key|unique/i);

    await client.query(
      `INSERT INTO public.sales (invoice_number, branch_id, cashier_id, total, paid_amount, payment_method)
       VALUES ($1, $2, $3, 100, 100, 'cash')`,
      [invoice, branchB, cashier],
    );
  });

  it('keeps the recovery RPC unavailable to anon/public', async () => {
    const acl = await client.query<{ anon_exec: boolean; auth_exec: boolean }>(
      `SELECT
         has_function_privilege('anon', 'public.reconcile_offline_sale(text,uuid,numeric,text)', 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', 'public.reconcile_offline_sale(text,uuid,numeric,text)', 'EXECUTE') AS auth_exec`,
    );
    expect(acl.rows[0]).toEqual({ anon_exec: false, auth_exec: true });
  });
});
