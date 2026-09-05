import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('P0-B branch-scoped SECURITY DEFINER reads', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const managerId = randomUUID();
  const targetA = randomUUID();
  const targetB = randomUUID();
  const superAdminId = randomUUID();
  const roleName = `p0b_scope_${randomUUID().slice(0, 8)}`;
  const productA = randomUUID();
  const productB = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(fn: () => Promise<unknown>, expected: string): Promise<void> {
    const savepoint = `sp_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    let message = '';
    try {
      await fn();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    expect(message).toContain(expected);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'P0-B Branch A'), ($2, 'P0-B Branch B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, branch_id, is_active)
       VALUES ($1, 'P0-B scoped reader', 'P0-B scoped reader',
               '["products.view","users.branches.manage"]'::jsonb,
               'branch', $2, true)`,
      [roleName, branchA],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES
         ($1, $2, 'P0-B Manager', $3, $4, true),
         ($5, $6, 'P0-B Target A', 'cashier', $4, true),
         ($7, $8, 'P0-B Target B', 'cashier', $9, true),
         ($10, $11, 'P0-B Super Admin', 'super_admin', $4, true)`,
      [
        managerId, `${randomUUID()}@test.local`, roleName, branchA,
        targetA, `${randomUUID()}@test.local`,
        targetB, `${randomUUID()}@test.local`, branchB,
        superAdminId, `${randomUUID()}@test.local`,
      ],
    );

    // Some schema revisions automatically mirror users.branch_id into
    // user_branch_access. Keep the fixture idempotent across those revisions.
    await client.query(
      `INSERT INTO public.user_branch_access (user_id, branch_id)
       VALUES ($1, $2), ($3, $2), ($4, $5)
       ON CONFLICT (user_id, branch_id) DO NOTHING`,
      [managerId, branchA, targetA, targetB, branchB],
    );

    await client.query(
      `INSERT INTO public.products (id, name, cost_price, sale_price, branch_id, is_active)
       VALUES ($1, 'P0-B Product A', 10, 20, $2, true),
              ($3, 'P0-B Product B', 30, 40, $4, true)`,
      [productA, branchA, productB, branchB],
    );
    await client.query(
      `INSERT INTO public.product_cost_history (product_id, old_cost, new_cost, source)
       VALUES ($1, 9, 10, 'p0b-test'), ($2, 29, 30, 'p0b-test')`,
      [productA, productB],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('allows product cost history only inside an accessible branch', async () => {
    const allowed = await asUser(managerId, () =>
      client.query(`SELECT * FROM public.get_cost_history($1, 10)`, [productA]),
    );
    expect(allowed.rows).toHaveLength(1);

    await expectDbError(
      () => asUser(managerId, () => client.query(`SELECT * FROM public.get_cost_history($1, 10)`, [productB])),
      'BRANCH_MISMATCH',
    );
  });

  it('allows self branch-access inspection', async () => {
    const own = await asUser(managerId, () =>
      client.query(`SELECT branch_id FROM public.get_user_branch_access($1)`, [managerId]),
    );
    expect(own.rows.map((row) => row.branch_id)).toContain(branchA);
  });

  it('allows delegated branch managers to inspect only in-scope users', async () => {
    const inScope = await asUser(managerId, () =>
      client.query(`SELECT branch_id FROM public.get_user_branch_access($1)`, [targetA]),
    );
    expect(inScope.rows.map((row) => row.branch_id)).toContain(branchA);

    await expectDbError(
      () => asUser(managerId, () => client.query(`SELECT * FROM public.get_user_branch_access($1)`, [targetB])),
      'TARGET_OUT_OF_SCOPE',
    );
  });

  it('never exposes Super Admin branch assignments to a delegated manager', async () => {
    await expectDbError(
      () => asUser(managerId, () => client.query(`SELECT * FROM public.get_user_branch_access($1)`, [superAdminId])),
      'PERMISSION_DENIED:super_admin',
    );
  });

  it('allows Super Admin to inspect cross-branch data', async () => {
    await asUser(superAdminId, async () => {
      const cost = await client.query(`SELECT * FROM public.get_cost_history($1, 10)`, [productB]);
      expect(cost.rows).toHaveLength(1);
      const grants = await client.query(`SELECT branch_id FROM public.get_user_branch_access($1)`, [targetB]);
      expect(grants.rows.map((row) => row.branch_id)).toContain(branchB);
    });
  });
});