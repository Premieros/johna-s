import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('POS availability authoritative zero vs unknown source', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const otherBranchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const adminUserId = randomUUID();
  const branchUserId = randomUUID();
  const readyProductId = randomUUID();
  const unresolvedProductId = randomUUID();
  const unresolvedUnitId = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query('SAVEPOINT availability_user_scope');
    try {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      await client.query(`SET LOCAL ROLE service_role`);
      const result = await fn();
      await client.query('RESET ROLE');
      await client.query('RESET app.user_id');
      await client.query('RELEASE SAVEPOINT availability_user_scope');
      return result;
    } catch (error) {
      // Expected SQL rejections (branch/warehouse denial) abort PostgreSQL's
      // current transaction. Roll back only this user scope so subsequent
      // assertions can continue inside the suite's outer fixture transaction.
      await client.query('ROLLBACK TO SAVEPOINT availability_user_scope').catch(() => {});
      await client.query('RELEASE SAVEPOINT availability_user_scope').catch(() => {});
      throw error;
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'Availability Contract Branch'), ($2, 'Other Availability Branch')`,
      [branchId, otherBranchId],
    );

    for (const [id, email] of [
      [adminUserId, `availability-admin-${adminUserId}@example.test`],
      [branchUserId, `availability-user-${branchUserId}@example.test`],
    ] as const) {
      await client.query(
        `INSERT INTO auth.users (id,email,role,aud,instance_id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
         VALUES ($1,$2,'authenticated','authenticated',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,now(),now())`,
        [id, email],
      );
    }

    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES
         ($1,$2,'Availability Super Admin','super_admin',$3,true),
         ($4,$5,'Availability Branch User','cashier',$3,true)`,
      [
        adminUserId,
        `availability-admin-${adminUserId}@example.test`,
        branchId,
        branchUserId,
        `availability-user-${branchUserId}@example.test`,
      ],
    );

    await client.query(
      `INSERT INTO public.warehouses (id,name,branch_id,is_active)
       VALUES
         ($1,'Availability WH',$2,true),
         ($3,'Other Availability WH',$4,true)`,
      [warehouseId, branchId, otherWarehouseId, otherBranchId],
    );

    // A ready product with no batches has an authoritative quantity of zero.
    await client.query(
      `INSERT INTO public.products (id,name,branch_id,product_type,sale_price,cost_price,is_active)
       VALUES ($1,'Known Zero Product',$2,'ready',10,0,true)`,
      [readyProductId, branchId],
    );

    // This product points to an active manufactured unit with no recipe.
    // Its source is unresolved, so the POS must not fabricate a zero quantity.
    await client.query(
      `INSERT INTO public.inventory_units (id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
       VALUES ($1,$2,'Unresolved Manufactured Unit','manufactured',$3,0,0,true)`,
      [unresolvedUnitId, `UNIT-${randomUUID()}`, branchId],
    );
    await client.query(
      `INSERT INTO public.products (id,name,branch_id,product_type,sale_price,cost_price,is_active)
       VALUES ($1,'Unknown Source Product',$2,'ready',15,0,true)`,
      [unresolvedProductId, branchId],
    );
    await client.query(
      `INSERT INTO public.product_unit_links (product_id,unit_id,quantity)
       VALUES ($1,$2,1)`,
      [unresolvedProductId, unresolvedUnitId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  });

  it('returns a known empty ready product as an authoritative zero row', async () => {
    await asUser(adminUserId, async () => {
      const rows = await q<{ available_quantity: string; is_available: boolean }>(
        `SELECT available_quantity::text, is_available
         FROM public.get_pos_product_availability($1,$2,100)
         WHERE product_id=$3`,
        [branchId, warehouseId, readyProductId],
      );

      expect(rows).toHaveLength(1);
      expect(Number(rows[0].available_quantity)).toBe(0);
      expect(rows[0].is_available).toBe(false);
    });
  });

  it('returns an explicit blocked row when the inventory source cannot be resolved', async () => {
    await asUser(adminUserId, async () => {
      const direct = await q<{ result: { success: boolean; error?: string } }>(
        `SELECT public.check_product_availability($1,$2,$3,1) AS result`,
        [unresolvedProductId, branchId, warehouseId],
      );
      expect(direct[0].result.success).toBe(false);
      expect(direct[0].result.error).toBe('MANUFACTURED_UNIT_HAS_NO_RECIPE');

      const rows = await q<{ available_quantity: string; is_available: boolean; raw_shortage_only: boolean; availability_error: string | null }>(
        `SELECT available_quantity::text,is_available,raw_shortage_only,availability_error
         FROM public.get_pos_product_availability($1,$2,100)
         WHERE product_id=$3`,
        [branchId, warehouseId, unresolvedProductId],
      );
      expect(rows).toEqual([{
        available_quantity: '0',
        is_available: false,
        raw_shortage_only: false,
        availability_error: 'MANUFACTURED_UNIT_HAS_NO_RECIPE',
      }]);
    });
  });

  it('rejects cross-branch availability reads for a normal authenticated user', async () => {
    await expect(
      asUser(branchUserId, () =>
        client.query(
          `SELECT * FROM public.get_pos_product_availability($1,$2,100)`,
          [otherBranchId, otherWarehouseId],
        ),
      ),
    ).rejects.toThrow(/BRANCH_ACCESS_DENIED/);
  });

  it('rejects a warehouse that does not belong to the requested branch', async () => {
    await expect(
      asUser(branchUserId, () =>
        client.query(
          `SELECT * FROM public.get_pos_product_availability($1,$2,100)`,
          [branchId, otherWarehouseId],
        ),
      ),
    ).rejects.toThrow(/WAREHOUSE_NOT_IN_BRANCH/);
  });

  it('keeps known stock shortage codes explicit in the server contract', async () => {
    const fn = await q<{ definition: string }>(
      `SELECT pg_get_functiondef('public.get_pos_product_availability(uuid,uuid,integer)'::regprocedure) AS definition`,
    );
    expect(fn[0].definition).toContain('INSUFFICIENT_PRODUCT_STOCK');
    expect(fn[0].definition).toContain('INSUFFICIENT_UNIT_STOCK');
    expect(fn[0].definition).toContain('INSUFFICIENT_RAW_MATERIAL_STOCK');
  });
});
