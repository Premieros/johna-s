import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

const legacy = [
  'pos.sell','pos.pay','pos.split_order','pos.transfer_order','products.manage','inventory.manage',
  'inventory.transfers','inventory.transfers.approve','catalog.view','procurement.view','accounting.view','admin.view',
];

describe.skipIf(skip)('Permission-First final-state drift sentinel', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('keeps owner as a normal permission-driven role label', async () => {
    const r = await client.query<{ owner_normalizer_absent: boolean; permission_def: string }>(`
      SELECT
        to_regprocedure('public.normalize_retired_owner_role()') IS NULL AS owner_normalizer_absent,
        pg_get_functiondef('public.can_permission(text)'::regprocedure) AS permission_def
    `);
    expect(r.rows[0].owner_normalizer_absent).toBe(true);
    expect(r.rows[0].permission_def).toContain('JOIN public.roles');
    expect(r.rows[0].permission_def).toContain('r.permissions');
    expect(r.rows[0].permission_def).not.toContain("u.role = 'owner'");
    expect(r.rows[0].permission_def).not.toContain("u.role IN ('super_admin', 'owner')");
  });

  it('stores only canonical role permission keys for all retired aliases', async () => {
    const r = await client.query<{ permission: string }>(`
      SELECT DISTINCT x.permission
      FROM public.roles r
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.permissions,'[]'::jsonb)) x(permission)
      WHERE x.permission = ANY($1::text[])
      ORDER BY 1
    `, [legacy]);
    expect(r.rows).toEqual([]);
  });

  it('keeps Super Admin as the only implicit permission bypass', async () => {
    const r = await client.query<{ admin_def: string; permission_def: string }>(`
      SELECT
        pg_get_functiondef('public.is_pos_admin()'::regprocedure) AS admin_def,
        pg_get_functiondef('public.can_permission(text)'::regprocedure) AS permission_def
    `);
    const adminDef = r.rows[0].admin_def;
    const permissionDef = r.rows[0].permission_def;
    expect(adminDef).toContain("u.role = 'super_admin'");
    expect(adminDef).not.toContain("'owner'");
    expect(permissionDef).toContain('JOIN public.roles');
    expect(permissionDef).toContain('r.permissions');
  });

  it('has no role-label authorization helper or fixed operational role gates', async () => {
    const helper = await client.query(`SELECT to_regprocedure('public.is_branch_manager()') IS NULL AS absent`);
    expect(helper.rows[0].absent).toBe(true);

    const r = await client.query<{ fn: string }>(`
      SELECT p.oid::regprocedure::text AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f'
        AND p.proname NOT IN ('guard_user_role_changes')
        AND (
          pg_get_functiondef(p.oid) ~ 'get_user_role\\(\\)[[:space:]]*(=|<>)[[:space:]]*''(owner|branch_manager|accountant|warehouse_manager|cashier)'''
          OR pg_get_functiondef(p.oid) ~ 'get_user_role\\(\\)[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\\([^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)'''
          OR pg_get_functiondef(p.oid) ~ 'v_role[[:space:]]*(=|<>)[[:space:]]*''(owner|branch_manager|accountant|warehouse_manager|cashier)'''
          OR pg_get_functiondef(p.oid) ~ 'v_role[[:space:]]+(NOT[[:space:]]+)?IN[[:space:]]*\\([^)]*''(owner|branch_manager|accountant|warehouse_manager|cashier)'''
        )
      ORDER BY 1
    `);
    expect(r.rows).toEqual([]);
  });

  it('has no RLS policy authorization based on fixed operational roles', async () => {
    const r = await client.query<{ policy: string }>(`
      SELECT schemaname||'.'||tablename||'.'||policyname AS policy
      FROM pg_policies
      WHERE schemaname='public' AND (
        COALESCE(qual,'') ~ 'is_branch_manager|''owner''|''branch_manager''|''accountant''|''warehouse_manager''|''cashier'''
        OR COALESCE(with_check,'') ~ 'is_branch_manager|''owner''|''branch_manager''|''accountant''|''warehouse_manager''|''cashier'''
      )
      ORDER BY 1
    `);
    expect(r.rows).toEqual([]);
  });
});
