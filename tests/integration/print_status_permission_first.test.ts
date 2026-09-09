import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('print status permission-first boundary', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const printerUser = randomUUID();
  const noPrintUser = randomUUID();
  const orderA = randomUUID();
  const orderB = randomUUID();

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

  async function expectDbError(fn: () => Promise<unknown>, message: string): Promise<void> {
    const sp = `sp_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${sp}`);
    let received = '';
    try {
      await fn();
    } catch (error) {
      received = String((error as { message?: string })?.message ?? error);
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    expect(received).toContain(message);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'Print Permission A'), ($2, 'Print Permission B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Receipt Printer', 'cashier', $3, true),
              ($4, $5, 'No Print User', 'production_manager', $3, true)`,
      [
        printerUser,
        `${randomUUID()}@test.local`,
        branchA,
        noPrintUser,
        `${randomUUID()}@test.local`,
      ],
    );

    // Make the permission matrix explicit inside this rollback-only fixture.
    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN jsonb_typeof(COALESCE(permissions, '[]'::jsonb)) = 'array'
           THEN (COALESCE(permissions, '[]'::jsonb) - 'pos.receipt.print') || '["pos.receipt.print"]'::jsonb
         ELSE jsonb_set(COALESCE(permissions, '{}'::jsonb), '{pos.receipt.print}', 'true'::jsonb, true)
       END,
       updated_at = now()
       WHERE role = 'cashier'`,
    );
    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN jsonb_typeof(COALESCE(permissions, '[]'::jsonb)) = 'array'
           THEN COALESCE(permissions, '[]'::jsonb) - 'pos.receipt.print'
         ELSE COALESCE(permissions, '{}'::jsonb) - 'pos.receipt.print'
       END,
       updated_at = now()
       WHERE role = 'production_manager'`,
    );

    await client.query(
      `INSERT INTO public.orders (id, order_number, branch_id, status, kitchen_status)
       VALUES ($1, 'PRINT-A', $2, 'open', 'pending'),
              ($3, 'PRINT-B', $4, 'open', 'pending')`,
      [orderA, branchA, orderB, branchB],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('rejects an authenticated caller without pos.receipt.print', async () => {
    await asUser(noPrintUser, async () => {
      await expectDbError(
        () => client.query(`SELECT public.set_print_status($1, 'printed')`, [orderA]),
        'PERMISSION_DENIED:pos.receipt.print',
      );
    });
  });

  it('rejects a permitted user attempting to mutate another branch', async () => {
    await asUser(printerUser, async () => {
      await expectDbError(
        () => client.query(`SELECT public.set_print_status($1, 'printed')`, [orderB]),
        'BRANCH_MISMATCH',
      );
    });
  });

  it('rejects invalid print state instead of reporting success', async () => {
    await asUser(printerUser, async () => {
      await expectDbError(
        () => client.query(`SELECT public.set_print_status($1, 'success')`, [orderA]),
        'INVALID_PRINT_STATUS',
      );
    });
  });

  it('records printed_at only after an authorized printed transition', async () => {
    await asUser(printerUser, async () => {
      const result = await client.query<{ value: { success?: boolean; print_status?: string } }>(
        `SELECT public.set_print_status($1, 'printed') AS value`,
        [orderA],
      );
      expect(result.rows[0]?.value?.success).toBe(true);
      expect(result.rows[0]?.value?.print_status).toBe('printed');

      const printed = await client.query<{ print_status: string; printed_at: Date | null }>(
        `SELECT print_status, printed_at FROM public.orders WHERE id = $1`,
        [orderA],
      );
      expect(printed.rows[0]?.print_status).toBe('printed');
      expect(printed.rows[0]?.printed_at).not.toBeNull();

      await client.query(`SELECT public.set_print_status($1, 'failed')`, [orderA]);
      const failed = await client.query<{ print_status: string; printed_at: Date | null }>(
        `SELECT print_status, printed_at FROM public.orders WHERE id = $1`,
        [orderA],
      );
      expect(failed.rows[0]?.print_status).toBe('failed');
      expect(failed.rows[0]?.printed_at).toBeNull();
    });
  });

  it('keeps execution restricted away from anon/public', async () => {
    const acl = await client.query<{ anon_exec: boolean; auth_exec: boolean }>(
      `SELECT
         has_function_privilege('anon', 'public.set_print_status(uuid,text)', 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', 'public.set_print_status(uuid,text)', 'EXECUTE') AS auth_exec`,
    );
    expect(acl.rows[0]?.anon_exec).toBe(false);
    expect(acl.rows[0]?.auth_exec).toBe(true);
  });
});
