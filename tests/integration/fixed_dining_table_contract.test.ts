import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('fixed dining table contract', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('seeds baseline tables 1..50 for every newly-created branch', async () => {
    await client.query('BEGIN');
    try {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO public.branches(name, is_active)
         VALUES ($1, true)
         RETURNING id`,
        [`table-contract-${Date.now()}`],
      );
      const branchId = branch.rows[0].id;

      const tables = await client.query<{ name: string }>(
        `SELECT name
         FROM public.dining_tables
         WHERE branch_id = $1
           AND name ~ '^[0-9]+$'
           AND name::integer BETWEEN 1 AND 50
         ORDER BY name::integer`,
        [branchId],
      );

      expect(tables.rows).toHaveLength(50);
      expect(tables.rows.map((row) => row.name)).toEqual(
        Array.from({ length: 50 }, (_, index) => String(index + 1)),
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('keeps floor-plan mutation permission-first and branch-scoped', async () => {
    const rows = await client.query<{ name: string; definition: string; config: string[] | null; auth_exec: boolean; anon_exec: boolean }>(
      `SELECT p.proname AS name,
              pg_get_functiondef(p.oid) AS definition,
              p.proconfig AS config,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [['floor_plan_add_table', 'floor_plan_update_table']],
    );

    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.config ?? []).toContain('search_path=public, pg_temp');
      expect(row.auth_exec).toBe(true);
      expect(row.anon_exec).toBe(false);
      expect(row.definition).toContain("public.can_permission('floor_plan.manage')");
      expect(row.definition).toContain('public.user_may_access_branch');
      expect(row.definition).not.toMatch(/role\s*=\s*['\"](?:manager|branch_manager|admin)['\"]/i);
    }
  });

  it('blocks authenticated direct INSERT and UPDATE of dining tables', async () => {
    const policies = await client.query<{ policyname: string; cmd: string; with_check: string | null; qual: string | null }>(
      `SELECT policyname, cmd, with_check, qual
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'dining_tables'
         AND policyname IN ('auth_insert_dining_tables', 'auth_update_dining_tables')
       ORDER BY policyname`,
    );

    expect(policies.rows).toHaveLength(2);
    const insert = policies.rows.find((row) => row.cmd === 'INSERT');
    const update = policies.rows.find((row) => row.cmd === 'UPDATE');
    expect(insert?.with_check).toBe('false');
    expect(update?.qual).toBe('false');
    expect(update?.with_check).toBe('false');
  });

  it('keeps POS structural actions away from table creation and layout mutation', async () => {
    const rows = await client.query<{ name: string; definition: string }>(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [[
        'perform_pos_order_action',
        'transfer_order_item_to_table',
        '_create_structural_target_order',
      ]],
    );

    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row.definition).not.toMatch(/insert\s+into\s+(?:public\.)?dining_tables/i);
      expect(row.definition).not.toMatch(/update\s+(?:public\.)?dining_tables[\s\S]*\blayout\s*=/i);
    }
  });

  it('keeps table status updates canonical and does not expose layout changes', async () => {
    const row = await client.query<{ definition: string; security_definer: boolean }>(
      `SELECT pg_get_functiondef(p.oid) AS definition, p.prosecdef AS security_definer
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'set_table_status'`,
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].security_definer).toBe(true);
    expect(row.rows[0].definition).toMatch(/update\s+(?:public\.)?dining_tables/i);
    expect(row.rows[0].definition).not.toMatch(/\blayout\s*=/i);
  });
});
