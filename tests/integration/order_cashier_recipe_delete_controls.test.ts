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

  it('keeps direct recipe deletes denied by RLS', async () => {
    const { rows } = await client.query<{ tablename: string; qual: string }>(`
      SELECT tablename, qual
      FROM pg_policies
      WHERE schemaname='public'
        AND policyname IN ('auth_delete_recipe_items','auth_delete_recipes')
      ORDER BY tablename
    `);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.qual).toBe('false');
  });

  it('updates recipe items only through a permission and branch guarded RPC', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public.update_recipe_with_items(uuid,text,numeric,text,boolean,jsonb)'::regprocedure) AS def
    `);
    const def = rows[0].def;
    expect(def).toContain("can_permission('recipes.manage')");
    expect(def).toContain('user_may_access_branch(v_branch_id)');
    expect(def).toContain('DELETE FROM public.recipe_items');
    expect(def).toContain('RAW_MATERIAL_NOT_IN_BRANCH');
    expect(def).toContain('DUPLICATE_RAW_MATERIAL');
  });

  it('deletes a whole recipe only through the guarded RPC', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef('public.delete_recipe_controlled(uuid)'::regprocedure) AS def
    `);
    const def = rows[0].def;
    expect(def).toContain("can_permission('recipes.manage')");
    expect(def).toContain('user_may_access_branch(v_branch_id)');
    expect(def).toContain('DELETE FROM public.recipes');
    expect(def).toContain('RECIPE_DELETED');
  });

  it('recipe mutation RPCs are authenticated/service only', async () => {
    const { rows } = await client.query<{
      update_anon: boolean; update_auth: boolean; update_service: boolean;
      delete_anon: boolean; delete_auth: boolean; delete_service: boolean;
    }>(`
      SELECT
        has_function_privilege('anon','public.update_recipe_with_items(uuid,text,numeric,text,boolean,jsonb)','EXECUTE') AS update_anon,
        has_function_privilege('authenticated','public.update_recipe_with_items(uuid,text,numeric,text,boolean,jsonb)','EXECUTE') AS update_auth,
        has_function_privilege('service_role','public.update_recipe_with_items(uuid,text,numeric,text,boolean,jsonb)','EXECUTE') AS update_service,
        has_function_privilege('anon','public.delete_recipe_controlled(uuid)','EXECUTE') AS delete_anon,
        has_function_privilege('authenticated','public.delete_recipe_controlled(uuid)','EXECUTE') AS delete_auth,
        has_function_privilege('service_role','public.delete_recipe_controlled(uuid)','EXECUTE') AS delete_service
    `);
    expect(rows[0]).toEqual({
      update_anon: false, update_auth: true, update_service: true,
      delete_anon: false, delete_auth: true, delete_service: true,
    });
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
    expect(def.toLowerCase()).toContain("old.status not in ('open', 'held')");
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
