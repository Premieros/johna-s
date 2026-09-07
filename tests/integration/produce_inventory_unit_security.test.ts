import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('produce_inventory_unit security boundary', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const warehouseB = randomUUID();
  const noPermUser = randomUUID();
  const inactiveUser = randomUUID();
  const producerUser = randomUUID();
  const noPermRole = `qa_prod_none_${randomUUID().slice(0, 8)}`;
  const producerRole = `qa_prod_manage_${randomUUID().slice(0, 8)}`;

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const savepoint = `produce_inventory_unit_user_${randomUUID().replaceAll('-', '')}`;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await fn();
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
      await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
      throw error;
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function productionRowCount(branchId: string): Promise<number> {
    return (
      await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.inventory_unit_productions WHERE branch_id=$1`,
        [branchId],
      )
    ).rows[0].count;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id,name) VALUES ($1,'QA Production A'),($2,'QA Production B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES
       ($1,'QA Production WH A',$3,true),
       ($2,'QA Production WH B',$4,true)`,
      [warehouseA, warehouseB, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'بدون تصنيع','No production','[]'::jsonb,'global',true),
       ($2,'إدارة تصنيع','Production manage','["production.manage"]'::jsonb,'global',true)`,
      [noPermRole, producerRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'No Production Permission',$7,$6,true),
       ($3,$4,'Inactive Producer',$8,$6,false),
       ($5,$9,'Authorized Producer',$8,$6,true)`,
      [
        noPermUser, `${noPermUser}@test.local`,
        inactiveUser, `${inactiveUser}@test.local`,
        producerUser, branchA,
        noPermRole, producerRole,
        `${producerUser}@test.local`,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens search_path and preserves only authenticated + trusted backend execute', async () => {
    const row = await client.query<{
      config: string[] | null;
      authenticated_execute: boolean;
      service_role_execute: boolean;
      anon_execute: boolean;
    }>(`
      SELECT p.proconfig AS config,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.oid='public.produce_inventory_unit(uuid,numeric,uuid,uuid,text)'::regprocedure
    `);

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].config ?? []).toContain('search_path=public, pg_temp');
    expect(row.rows[0].authenticated_execute).toBe(true);
    expect(row.rows[0].service_role_execute).toBe(true);
    expect(row.rows[0].anon_execute).toBe(false);
  });

  it('uses Permission-First and canonical branch/warehouse guards before mutation', async () => {
    const definition = (
      await client.query<{ definition: string }>(
        `SELECT pg_get_functiondef('public.produce_inventory_unit(uuid,numeric,uuid,uuid,text)'::regprocedure) AS definition`,
      )
    ).rows[0].definition;

    expect(definition).toContain("current_setting('role'::text, true)");
    expect(definition).toContain("can_permission('production.manage')");
    expect(definition).toContain('user_may_access_branch(p_branch_id)');
    expect(definition).toContain('w.branch_id = p_branch_id');
    expect(definition).toContain('w.is_active = true');
    expect(definition).not.toContain('is_pos_admin()');
    expect(definition).not.toMatch(/role\s*(?:=|IN)\s*['(]/i);
  });

  it('denies inactive or permissionless callers without production writes', async () => {
    const before = await productionRowCount(branchA);

    await expect(
      asUser(inactiveUser, () =>
        client.query(`SELECT public.produce_inventory_unit($1,1,$2,$3,NULL)`, [randomUUID(), warehouseA, branchA]),
      ),
    ).rejects.toThrow(/USER_INACTIVE/);

    await expect(
      asUser(noPermUser, () =>
        client.query(`SELECT public.produce_inventory_unit($1,1,$2,$3,NULL)`, [randomUUID(), warehouseA, branchA]),
      ),
    ).rejects.toThrow(/PRODUCTION_NOT_ALLOWED/);

    expect(await productionRowCount(branchA)).toBe(before);
  });

  it('denies foreign branches and branch/warehouse mismatch before unit lookup', async () => {
    const beforeA = await productionRowCount(branchA);
    const beforeB = await productionRowCount(branchB);

    await expect(
      asUser(producerUser, () =>
        client.query(`SELECT public.produce_inventory_unit($1,1,$2,$3,NULL)`, [randomUUID(), warehouseB, branchB]),
      ),
    ).rejects.toThrow(/BRANCH_ACCESS_DENIED/);

    await expect(
      asUser(producerUser, () =>
        client.query(`SELECT public.produce_inventory_unit($1,1,$2,$3,NULL)`, [randomUUID(), warehouseB, branchA]),
      ),
    ).rejects.toThrow(/WAREHOUSE_NOT_FOUND/);

    expect(await productionRowCount(branchA)).toBe(beforeA);
    expect(await productionRowCount(branchB)).toBe(beforeB);
  });

  it('allows an authorized same-branch/same-warehouse caller to reach existing unit validation', async () => {
    await expect(
      asUser(producerUser, () =>
        client.query(`SELECT public.produce_inventory_unit($1,1,$2,$3,NULL)`, [randomUUID(), warehouseA, branchA]),
      ),
    ).rejects.toThrow(/is not a manufactured active inventory unit/);
  });
});
