import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('shift cash integrity and scope', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    await client?.end().catch(() => {});
  });

  it('keeps shift_operations read-only for authenticated clients', async () => {
    const { rows } = await client.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(`
      SELECT
        has_table_privilege('authenticated', 'public.shift_operations', 'SELECT') AS can_select,
        has_table_privilege('authenticated', 'public.shift_operations', 'INSERT') AS can_insert,
        has_table_privilege('authenticated', 'public.shift_operations', 'UPDATE') AS can_update,
        has_table_privilege('authenticated', 'public.shift_operations', 'DELETE') AS can_delete
    `);

    expect(rows[0].can_select).toBe(true);
    expect(rows[0].can_insert).toBe(false);
    expect(rows[0].can_update).toBe(false);
    expect(rows[0].can_delete).toBe(false);
  });

  it('uses the same cash movement categories through the canonical shift cash helper', async () => {
    const { rows } = await client.query<{ proname: string; def: string }>(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_active_shift', 'close_shift', 'force_close_shift', '_compute_shift_expected_cash')
        AND p.prokind = 'f'
      ORDER BY p.proname
    `);

    expect(rows).toHaveLength(4);
    const helper = rows.find((row) => row.proname === '_compute_shift_expected_cash');
    expect(helper?.def).toContain('cash_in');
    expect(helper?.def).toContain('cash_out');
    expect(helper?.def).toContain('refund');
    expect(helper?.def).toContain('expense');
    expect(helper?.def).toContain('cash');

    const close = rows.find((row) => row.proname === 'close_shift');
    expect(close?.def).toContain('public._compute_shift_expected_cash(p_shift_id)');

    const force = rows.find((row) => row.proname === 'force_close_shift');
    expect(force?.def).toContain('cash_in');
    expect(force?.def).toContain('cash_out');
    expect(force?.def).toContain('refund');
    expect(force?.def).toContain('expense');

    const active = rows.find((row) => row.proname === 'get_active_shift');
    expect(active?.def).toContain('cash_in');
    expect(active?.def).toContain('cash_out');
    expect(active?.def).toContain('refund');
    expect(active?.def).toContain('expense');
  });

  it('scopes force-close and open-drawer shift lookup through canonical branch access', async () => {
    const { rows } = await client.query<{ proname: string; def: string }>(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('force_close_shift', 'authorize_open_drawer')
        AND p.prokind = 'f'
      ORDER BY p.proname
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.def).toContain('public.user_may_access_branch(s.branch_id)');
      expect(row.def).not.toContain('v_user_branch <> v_shift.branch_id');
      expect(row.def).not.toContain("RETURN jsonb_build_object('success', false, 'error', 'BRANCH_MISMATCH')");
    }
  });

  it('preserves trusted server RPC writes to the shift ledger', async () => {
    const { rows } = await client.query<{ proname: string; def: string }>(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('open_shift', '_process_sale_core', '_process_refund_single_core', 'process_refund')
        AND p.prokind = 'f'
      ORDER BY p.proname
    `);

    expect(rows).toHaveLength(4);
    const names = new Set(rows.map((row) => row.proname));
    expect(names).toEqual(new Set(['open_shift', '_process_sale_core', '_process_refund_single_core', 'process_refund']));
    expect(rows.some((row) => row.def.includes('INSERT INTO public.shift_operations') || row.def.includes('INSERT INTO shift_operations'))).toBe(true);
  });
});
