import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('warehouse lifecycle security', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = randomUUID();
  const role = `qa_wh_${randomUUID().slice(0, 8)}`;
  const emptyWarehouse = randomUUID();
  const directEmptyWarehouse = randomUUID();
  const historyWarehouse = randomUUID();
  const foreignWarehouse = randomUUID();
  const productA = randomUUID();

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userA]);
    await client.query(`SET LOCAL ROLE authenticated`);
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

    await client.query(
      `INSERT INTO public.branches (id,name) VALUES ($1,'QA WH A'),($2,'QA WH B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'مخازن QA','QA Warehouses','["warehouses.manage"]'::jsonb,'global',true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'QA Warehouse User',$3,$4,true)`,
      [userA, `${randomUUID()}@test.local`, role, branchA],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES
       ($1,'History Warehouse',$3,true),($2,'Foreign Warehouse',$4,true)`,
      [historyWarehouse, foreignWarehouse, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.products (id,name,sale_price,branch_id,is_active)
       VALUES ($1,'QA Warehouse Product',10,$2,true)`,
      [productA, branchA],
    );
    await client.query(
      `INSERT INTO public.inventory (product_id,warehouse_id,quantity,branch_id)
       VALUES ($1,$2,5,$3)`,
      [productA, historyWarehouse, branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('gates direct warehouse DELETE through the dependency-safe helper', async () => {
    const policy = await client.query<{ qual: string | null }>(
      `SELECT qual FROM pg_policies
       WHERE schemaname='public' AND tablename='warehouses' AND policyname='auth_delete_warehouses'`,
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0].qual ?? '').toContain('warehouse_delete_allowed');
  });

  it('uses Permission-First warehouse management with an arbitrary role label', async () => {
    await asUser(async () => {
      const inserted = await client.query<{ id: string; name: string; is_active: boolean }>(
        `INSERT INTO public.warehouses (id,name,branch_id,is_active)
         VALUES ($1,'Lifecycle Warehouse',$2,true)
         RETURNING id,name,is_active`,
        [emptyWarehouse, branchA],
      );
      expect(inserted.rows[0]).toMatchObject({ id: emptyWarehouse, name: 'Lifecycle Warehouse', is_active: true });

      const updated = await client.query<{ name: string }>(
        `UPDATE public.warehouses SET name='Lifecycle Warehouse Edited' WHERE id=$1 RETURNING name`,
        [emptyWarehouse],
      );
      expect(updated.rows[0].name).toBe('Lifecycle Warehouse Edited');

      const disabled = await client.query<{ is_active: boolean }>(
        `UPDATE public.warehouses SET is_active=false WHERE id=$1 RETURNING is_active`,
        [emptyWarehouse],
      );
      expect(disabled.rows[0].is_active).toBe(false);

      const enabled = await client.query<{ is_active: boolean }>(
        `UPDATE public.warehouses SET is_active=true WHERE id=$1 RETURNING is_active`,
        [emptyWarehouse],
      );
      expect(enabled.rows[0].is_active).toBe(true);
    });
  });

  it('does not expose another branch warehouse through RLS or safe-delete RPC', async () => {
    await asUser(async () => {
      const rows = await client.query(`SELECT id FROM public.warehouses WHERE id=$1`, [foreignWarehouse]);
      expect(rows.rows).toHaveLength(0);

      const deleted = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.delete_warehouse_safe($1) AS r`,
        [foreignWarehouse],
      );
      expect(deleted.rows[0].r).toMatchObject({ success: false, error: 'WAREHOUSE_NOT_FOUND' });
    });
  });

  it('prevents moving a warehouse between branches even outside RLS', async () => {
    await client.query('SAVEPOINT warehouse_branch_probe');
    try {
      await expect(
        client.query(`UPDATE public.warehouses SET branch_id=$1 WHERE id=$2`, [branchB, historyWarehouse]),
      ).rejects.toThrow(/WAREHOUSE_BRANCH_IMMUTABLE/);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT warehouse_branch_probe');
      await client.query('RELEASE SAVEPOINT warehouse_branch_probe');
    }
  });

  it('allows direct DELETE only for an authorized unreferenced warehouse', async () => {
    await asUser(async () => {
      await client.query(
        `INSERT INTO public.warehouses (id,name,branch_id,is_active)
         VALUES ($1,'Direct Empty Warehouse',$2,true)`,
        [directEmptyWarehouse, branchA],
      );

      const emptyDelete = await client.query(`DELETE FROM public.warehouses WHERE id=$1 RETURNING id`, [directEmptyWarehouse]);
      expect(emptyDelete.rows).toHaveLength(1);

      const historyDelete = await client.query(`DELETE FROM public.warehouses WHERE id=$1 RETURNING id`, [historyWarehouse]);
      expect(historyDelete.rows).toHaveLength(0);
    });

    const historicalStillThere = await client.query(`SELECT id FROM public.warehouses WHERE id=$1`, [historyWarehouse]);
    expect(historicalStillThere.rows).toHaveLength(1);
  });

  it('hard-deletes only a genuinely empty warehouse through the safe RPC and allows recreation', async () => {
    await asUser(async () => {
      const deleted = await client.query<{ r: { success?: boolean; warehouse_id?: string } }>(
        `SELECT public.delete_warehouse_safe($1) AS r`,
        [emptyWarehouse],
      );
      expect(deleted.rows[0].r).toMatchObject({ success: true, warehouse_id: emptyWarehouse });
    });

    const gone = await client.query(`SELECT id FROM public.warehouses WHERE id=$1`, [emptyWarehouse]);
    expect(gone.rows).toHaveLength(0);

    await asUser(async () => {
      const recreated = await client.query<{ id: string }>(
        `INSERT INTO public.warehouses (id,name,branch_id,is_active)
         VALUES ($1,'Lifecycle Warehouse Recreated',$2,true) RETURNING id`,
        [emptyWarehouse, branchA],
      );
      expect(recreated.rows[0].id).toBe(emptyWarehouse);
    });
  });

  it('rejects hard delete when stock/history exists and preserves it across disable/re-enable', async () => {
    await asUser(async () => {
      const first = await client.query<{ r: { success?: boolean; error?: string; action?: string; blockers?: string[] } }>(
        `SELECT public.delete_warehouse_safe($1) AS r`,
        [historyWarehouse],
      );
      expect(first.rows[0].r).toMatchObject({
        success: false,
        error: 'WAREHOUSE_HAS_OPERATIONAL_HISTORY',
        action: 'DEACTIVATE_WAREHOUSE',
      });
      expect(first.rows[0].r.blockers ?? []).toContain('inventory.warehouse_id');

      await client.query(`UPDATE public.warehouses SET is_active=false WHERE id=$1`, [historyWarehouse]);
      const second = await client.query<{ r: { error?: string } }>(
        `SELECT public.delete_warehouse_safe($1) AS r`,
        [historyWarehouse],
      );
      expect(second.rows[0].r.error).toBe('WAREHOUSE_HAS_OPERATIONAL_HISTORY');

      await client.query(`UPDATE public.warehouses SET is_active=true WHERE id=$1`, [historyWarehouse]);
    });

    const warehouse = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.warehouses WHERE id=$1`, [historyWarehouse],
    );
    expect(warehouse.rows[0].is_active).toBe(true);

    const stock = await client.query<{ quantity: string }>(
      `SELECT quantity::text AS quantity FROM public.inventory WHERE warehouse_id=$1`, [historyWarehouse],
    );
    expect(stock.rows).toHaveLength(1);
    expect(Number(stock.rows[0].quantity)).toBe(5);
  });
});
