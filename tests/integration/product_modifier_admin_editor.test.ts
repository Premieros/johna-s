import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

let client: pg.Client;
let canRun = false;

beforeAll(async () => {
  const dbUrl = getDbUrl();
  if (!dbUrl) return;
  try {
    client = openDb(dbUrl);
    await client.connect();
    canRun = true;
  } catch {
    canRun = false;
  }
}, 30_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
});

describe('product modifier admin editor security', () => {
  it('exposes the admin RPC but keeps the effect table private', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.get_product_modifiers_admin(uuid)', 'EXECUTE') AS admin_rpc,
        has_function_privilege('anon', 'public.get_product_modifiers_admin(uuid)', 'EXECUTE') AS anon_rpc,
        has_table_privilege('authenticated', 'public.product_modifier_inventory_effects', 'SELECT') AS effect_select
    `);
    expect(r.rows[0]).toMatchObject({ admin_rpc: true, anon_rpc: false, effect_select: false });
  });

  it('enforces explicit modifier permission plus branch access inside the admin RPC', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT pg_get_functiondef('public.get_product_modifiers_admin(uuid)'::regprocedure) AS def
    `);
    const def = String(r.rows[0]?.def || '');
    expect(def).toContain("can_permission('products.modifiers.manage')");
    expect(def).toContain('user_may_access_branch');
    expect(def).toContain('product_modifier_inventory_effects');
    expect(def).toContain('PERMISSION_DENIED');
    expect(def).not.toContain("'owner'");
    expect(def).not.toContain("'branch_manager'");
  });
});
