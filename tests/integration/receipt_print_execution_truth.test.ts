import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type PrintResult = {
  success?: boolean;
  error?: string;
  print_number?: number;
  is_reprint?: boolean;
  event_id?: string;
};

describe.skipIf(skip)('receipt print execution truth', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const printerUser = randomUUID();
  const saleA = randomUUID();
  const saleB = randomUUID();

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

  async function callPrintFunction(name: 'authorize_sale_print' | 'record_sale_print', saleId: string): Promise<PrintResult> {
    const result = await client.query<{ value: PrintResult }>(
      `SELECT public.${name}($1::uuid, NULL::uuid) AS value`,
      [saleId],
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
       VALUES ($1, 'Receipt Truth A'), ($2, 'Receipt Truth B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Receipt Truth Cashier', 'cashier', $3, true)`,
      [printerUser, `${randomUUID()}@test.local`, branchA],
    );

    // The fixture is permission-first: explicitly grant first-print permission
    // and explicitly remove direct reprint permission regardless of role defaults.
    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN jsonb_typeof(COALESCE(permissions, '[]'::jsonb)) = 'array'
           THEN ((COALESCE(permissions, '[]'::jsonb) - 'pos.receipt.print' - 'pos.reprint') || '["pos.receipt.print"]'::jsonb)
         ELSE jsonb_set(COALESCE(permissions, '{}'::jsonb) - 'pos.reprint', '{pos.receipt.print}', 'true'::jsonb, true)
       END,
       updated_at = now()
       WHERE role = 'cashier'`,
    );

    await client.query(
      `INSERT INTO public.sales (id, invoice_number, branch_id, cashier_id, total, paid_amount, payment_method)
       VALUES ($1, $2, $3, $4, 100, 100, 'cash'),
              ($5, $6, $7, $4, 50, 50, 'cash')`,
      [saleA, `PRINT-${randomUUID()}`, branchA, printerUser, saleB, `PRINT-${randomUUID()}`, branchB],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('authorization is non-mutating', async () => {
    await asUser(printerUser, async () => {
      const authorized = await callPrintFunction('authorize_sale_print', saleA);
      expect(authorized.success).toBe(true);
      expect(authorized.print_number).toBe(1);
      expect(authorized.is_reprint).toBe(false);

      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.sale_print_events WHERE sale_id = $1`,
        [saleA],
      );
      expect(Number(count.rows[0]?.count || 0)).toBe(0);
    });
  });

  it('records first print only through the execution RPC', async () => {
    await asUser(printerUser, async () => {
      const recorded = await callPrintFunction('record_sale_print', saleA);
      expect(recorded.success).toBe(true);
      expect(recorded.print_number).toBe(1);
      expect(recorded.is_reprint).toBe(false);
      expect(recorded.event_id).toBeTruthy();

      const events = await client.query<{ print_number: number }>(
        `SELECT print_number FROM public.sale_print_events WHERE sale_id = $1 ORDER BY print_number`,
        [saleA],
      );
      expect(events.rows.map((row) => row.print_number)).toEqual([1]);
    });
  });

  it('does not create a second print without pos.reprint or manager approval', async () => {
    await asUser(printerUser, async () => {
      const authorizeAgain = await callPrintFunction('authorize_sale_print', saleA);
      expect(authorizeAgain.success).toBe(false);
      expect(authorizeAgain.error).toBe('MANAGER_APPROVAL_REQUIRED');

      const recordAgain = await callPrintFunction('record_sale_print', saleA);
      expect(recordAgain.success).toBe(false);
      expect(recordAgain.error).toBe('MANAGER_APPROVAL_REQUIRED');

      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.sale_print_events WHERE sale_id = $1`,
        [saleA],
      );
      expect(Number(count.rows[0]?.count || 0)).toBe(1);
    });
  });

  it('rejects a sale from another branch', async () => {
    await asUser(printerUser, async () => {
      const result = await callPrintFunction('authorize_sale_print', saleB);
      expect(result.success).toBe(false);
      expect(result.error).toBe('BRANCH_MISMATCH');
    });
  });

  it('keeps both RPCs unavailable to anon and available to authenticated', async () => {
    const acl = await client.query<{
      auth_authorize: boolean;
      anon_authorize: boolean;
      auth_record: boolean;
      anon_record: boolean;
    }>(
      `SELECT
         has_function_privilege('authenticated', 'public.authorize_sale_print(uuid,uuid)', 'EXECUTE') AS auth_authorize,
         has_function_privilege('anon', 'public.authorize_sale_print(uuid,uuid)', 'EXECUTE') AS anon_authorize,
         has_function_privilege('authenticated', 'public.record_sale_print(uuid,uuid)', 'EXECUTE') AS auth_record,
         has_function_privilege('anon', 'public.record_sale_print(uuid,uuid)', 'EXECUTE') AS anon_record`,
    );
    expect(acl.rows[0]).toEqual({
      auth_authorize: true,
      anon_authorize: false,
      auth_record: true,
      anon_record: false,
    });
  });
});
