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

  it('keeps the existing canonical provisioner as the single 50-table seed path', async () => {
    const trigger = await client.query<{ trigger_name: string; definition: string }>(
      `SELECT t.tgname AS trigger_name, pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'branches'
         AND NOT t.tgisinternal
         AND t.tgname LIKE '%dining_tables%'
       ORDER BY t.tgname`,
    );

    expect(trigger.rows).toHaveLength(1);
    expect(trigger.rows[0].trigger_name).toBe('trg_provision_default_dining_tables');
    expect(trigger.rows[0].definition).toContain('private.provision_default_dining_tables_on_branch_insert()');
  });

  it('seeds exactly canonical tables 01..50 for every newly-created branch', async () => {
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
         ORDER BY name`,
        [branchId],
      );

      expect(tables.rows).toHaveLength(50);
      expect(tables.rows.map((row) => row.name)).toEqual(
        Array.from({ length: 50 }, (_, index) => `Table ${String(index + 1).padStart(2, '0')}`),
      );
      expect(tables.rows.some((row) => /^\d+$/.test(row.name))).toBe(false);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('keeps 50 canonical rows but syncs the active Main Area count from branch settings', async () => {
    await client.query('BEGIN');
    try {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO public.branches(name, is_active)
         VALUES ($1, true)
         RETURNING id`,
        [`configurable-main-area-${Date.now()}`],
      );
      const branchId = branch.rows[0].id;

      await client.query(
        `INSERT INTO public.branch_settings(branch_id, main_area_table_count)
         VALUES ($1, 20)
         ON CONFLICT (branch_id)
         DO UPDATE SET main_area_table_count = EXCLUDED.main_area_table_count, updated_at = now()`,
        [branchId],
      );

      const reduced = await client.query<{ total: string; active: string; max_active: string | null }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE is_active)::text AS active,
                MAX(substring(name from '([0-9]{2})$')::int) FILTER (WHERE is_active)::text AS max_active
         FROM public.dining_tables
         WHERE branch_id = $1
           AND name ~ '^Table (0[1-9]|[1-4][0-9]|50)$'`,
        [branchId],
      );

      expect(Number(reduced.rows[0].total)).toBe(50);
      expect(Number(reduced.rows[0].active)).toBe(20);
      expect(Number(reduced.rows[0].max_active)).toBe(20);

      await client.query('SAVEPOINT reject_manual_reactivation');
      await expect(client.query(
        `UPDATE public.dining_tables
         SET is_active = true
         WHERE branch_id = $1 AND name = 'Table 21'`,
        [branchId],
      )).rejects.toThrow(/DEFAULT_DINING_TABLE_FIXED/);
      await client.query('ROLLBACK TO SAVEPOINT reject_manual_reactivation');

      await client.query(
        `UPDATE public.branch_settings
         SET main_area_table_count = 25, updated_at = now()
         WHERE branch_id = $1`,
        [branchId],
      );

      const expanded = await client.query<{ active: string; max_active: string | null }>(
        `SELECT COUNT(*) FILTER (WHERE is_active)::text AS active,
                MAX(substring(name from '([0-9]{2})$')::int) FILTER (WHERE is_active)::text AS max_active
         FROM public.dining_tables
         WHERE branch_id = $1
           AND name ~ '^Table (0[1-9]|[1-4][0-9]|50)$'`,
        [branchId],
      );

      expect(Number(expanded.rows[0].active)).toBe(25);
      expect(Number(expanded.rows[0].max_active)).toBe(25);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('marks Main Area as the only default area and protects its fixed 50 table identities', async () => {
    await client.query('BEGIN');
    try {
      const branch = await client.query<{ id: string }>(
        `INSERT INTO public.branches(name, is_active) VALUES ($1, true) RETURNING id`,
        [`fixed-main-area-${Date.now()}`],
      );
      const branchId = branch.rows[0].id;
      const area = await client.query<{ id: string; name: string; is_default: boolean }>(
        `SELECT id,name,is_default FROM public.dining_areas WHERE branch_id=$1 ORDER BY is_default DESC,sort_order`,
        [branchId],
      );
      expect(area.rows.filter((row) => row.is_default)).toHaveLength(1);
      expect(area.rows[0]).toMatchObject({ name: 'Main Area', is_default: true });

      await client.query('SAVEPOINT reject_extra_default_table');
      await expect(client.query(
        `INSERT INTO public.dining_tables(branch_id,area_id,name,capacity,status,is_active)
         VALUES($1,$2,'Table 51',4,'vacant',true)`,
        [branchId, area.rows[0].id],
      )).rejects.toThrow(/DEFAULT_AREA_FIXED_50/);
      await client.query('ROLLBACK TO SAVEPOINT reject_extra_default_table');

      await client.query('SAVEPOINT reject_default_table_delete');
      await expect(client.query(
        `DELETE FROM public.dining_tables WHERE branch_id=$1 AND name='Table 01'`,
        [branchId],
      )).rejects.toThrow(/DEFAULT_DINING_TABLE_FIXED/);
      await client.query('ROLLBACK TO SAVEPOINT reject_default_table_delete');

      await client.query('SAVEPOINT reject_default_area_delete');
      await expect(client.query(
        `DELETE FROM public.dining_areas WHERE id=$1`,
        [area.rows[0].id],
      )).rejects.toThrow(/DEFAULT_DINING_AREA_FIXED/);
      await client.query('ROLLBACK TO SAVEPOINT reject_default_area_delete');
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
      expect(row.definition).not.toMatch(/role\s*=\s*['"](?:manager|branch_manager|admin)['"]/i);
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
