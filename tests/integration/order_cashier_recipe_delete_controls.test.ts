import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('order cashier assignment + recipe delete controls', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('recipe delete policies require recipes.manage and branch access', async () => {
    const { rows } = await client.query<{ tablename: string; qual: string }>(`
      SELECT tablename, qual
      FROM pg_policies
      WHERE schemaname='public'
        AND policyname IN ('auth_delete_recipe_items','auth_delete_recipes')
      ORDER BY tablename
    `);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.qual).toContain("can_permission('recipes.manage'::text)");
      expect(row.qual).toContain('user_may_access_branch');
      expect(row.qual).not.toBe('false');
    }
  });

  it('cashier reassignment is manager-capability scoped, branch checked, and audited', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public.guard_order_cashier_assignment()'::regprocedure) AS def
    `);
    const def = rows[0].def;
    expect(def).toContain("can_permission('pos.order.transfer')");
    expect(def).toContain("can_permission('users.manage')");
    expect(def).toContain("can_permission('pos.order.edit')");
    expect(def).toContain('user_branch_access');
    expect(def).toContain('TARGET_USER_NOT_IN_BRANCH');
    expect(def).toContain('ORDER_CASHIER_REASSIGNED');
    expect(def).toContain("OLD.status <> ALL (ARRAY['open'::text, 'held'::text])");
  });

  it('guard trigger is installed only on cashier_id updates', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      WHERE t.tgrelid='public.orders'::regclass
        AND t.tgname='trg_guard_order_cashier_assignment'
        AND NOT t.tgisinternal
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('BEFORE UPDATE OF cashier_id');
  });
});
