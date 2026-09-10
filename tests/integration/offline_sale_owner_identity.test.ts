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
};

describe.skipIf(skip)('offline sale originating-user identity', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const cashierA = randomUUID();
  const cashierB = randomUUID();
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

  async function reconcile(): Promise<ReconcileResult> {
    const result = await client.query<{ value: ReconcileResult }>(
      `SELECT public.reconcile_offline_sale($1::text, $2::uuid, $3::numeric, $4::text) AS value`,
      [invoice, branchId, 100, 'cash'],
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
       VALUES ($1, 'Offline Owner Identity')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Offline Cashier A', 'cashier', $3, true),
              ($4, $5, 'Offline Cashier B', 'cashier', $3, true)`,
      [
        cashierA,
        `${randomUUID()}@test.local`,
        branchId,
        cashierB,
        `${randomUUID()}@test.local`,
      ],
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
      [saleId, invoice, branchId, cashierA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('does not let another permitted cashier reconcile the queued sale', async () => {
    await asUser(cashierB, async () => {
      const result = await reconcile();
      expect(result.success).toBe(false);
      expect(result.error).toBe('OFFLINE_SALE_OWNER_MISMATCH');
    });
  });

  it('allows the originating cashier to reconcile the exact committed sale', async () => {
    await asUser(cashierA, async () => {
      const result = await reconcile();
      expect(result.success).toBe(true);
      expect(result.reconciled).toBe(true);
      expect(result.sale_id).toBe(saleId);
    });
  });
});
