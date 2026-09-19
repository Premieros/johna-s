import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('inventory availability branch guard', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const warehouseB = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const userA = randomUUID();

  async function asBranchAUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userA]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.organizations (id, name, slug)
       VALUES ($1, 'Inventory Scope Org', $2)`,
      [orgId, `inv-${randomUUID().slice(0, 8)}`],
    );

    await client.query(
      `INSERT INTO public.branches (id, name, organization_id)
       VALUES ($1, 'Inventory Branch A', $3),
              ($2, 'Inventory Branch B', $3)`,
      [branchA, branchB, orgId],
    );

    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES ($1, 'Warehouse A', $3, true),
              ($2, 'Warehouse B', $4, true)`,
      [warehouseA, warehouseB, branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.products (id, name, branch_id, is_active)
       VALUES ($1, 'Product A', $3, true),
              ($2, 'Product B', $4, true)`,
      [productA, productB, branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Inventory Scope User', 'cashier', $3, true)`,
      [userA, `${randomUUID()}@test.local`, branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('blocks availability reads for a branch the user cannot access', async () => {
    const result = await asBranchAUser(async () => {
      const r = await client.query(
        `SELECT public.check_product_availability($1, $2, $3, 1) AS r`,
        [productB, branchB, warehouseB],
      );
      return r.rows[0].r;
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('BRANCH_ACCESS_DENIED');
  });

  it('blocks a warehouse that does not belong to the authorized branch', async () => {
    const result = await asBranchAUser(async () => {
      const r = await client.query(
        `SELECT public.check_product_availability($1, $2, $3, 1) AS r`,
        [productA, branchA, warehouseB],
      );
      return r.rows[0].r;
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('WAREHOUSE_BRANCH_MISMATCH');
  });

  it('preserves the existing own-branch availability behavior', async () => {
    const result = await asBranchAUser(async () => {
      const r = await client.query(
        `SELECT public.check_product_availability($1, $2, $3, 1) AS r`,
        [productA, branchA, warehouseA],
      );
      return r.rows[0].r;
    });

    expect(result.error).not.toBe('BRANCH_ACCESS_DENIED');
    expect(result.error).not.toBe('WAREHOUSE_BRANCH_MISMATCH');
    expect(result.error).toBe('INSUFFICIENT_PRODUCT_STOCK');
  });
});
