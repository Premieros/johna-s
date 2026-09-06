import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('shared branch shift invariant', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('enforces one open shift per branch at the database boundary', async () => {
    const { rows } = await client.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'shifts'
        AND indexname = 'uq_shifts_one_open_per_branch'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef).toContain('(branch_id)');
    expect(rows[0].indexdef).toContain("status = 'open'");
  });

  it('resolves the active shift by branch rather than by cashier', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'get_active_shift'
        AND p.prokind = 'f'
    `);

    const def = rows[0].def;
    expect(def).toContain("s.status = 'open'");
    expect(def).toContain('public.user_may_access_branch(s.branch_id)');
    expect(def).not.toContain('cashier_id = v_uid');
    expect(def).not.toContain('cashier_id = auth.uid()');
  });

  it('returns the existing branch shift instead of creating a per-cashier shift', async () => {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'open_shift'
        AND p.prokind = 'f'
    `);

    const def = rows[0].def;
    expect(def).toContain("branch_id = p_branch_id AND status = 'open'");
    expect(def).toContain("'already_open', true");
    expect(def).toContain("'shared', true");
    expect(def).toContain("public.can_permission('shifts.open')");
    expect(def).toContain('public.user_may_access_branch(p_branch_id)');
  });

  it('allows sales and refunds to log against the branch shift while keeping actor attribution', async () => {
    const { rows } = await client.query<{ proname: string; def: string }>(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('_process_sale_core', '_process_refund_single_core', 'process_refund')
        AND p.prokind = 'f'
      ORDER BY p.proname
    `);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.def).not.toContain('cashier_id = auth.uid() AND branch_id');
    }

    const saleCore = rows.find((r) => r.proname === '_process_sale_core')!.def;
    expect(saleCore).toContain("WHERE id = p_shift_id AND branch_id = p_branch_id AND status = 'open'");
    expect(saleCore).toContain('created_by');
    expect(saleCore).toContain('auth.uid()');
  });
});
