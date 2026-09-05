import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

const repairedFunctions = [
  'create_organization_branch(uuid,text,text,text,text)',
  'delete_branch_cascade(uuid)',
  'get_user_branch_access(uuid)',
  'open_shift(uuid,numeric,text)',
  'user_may_access_branch(uuid)',
];

describe.skipIf(skip)('Production Permission-First drift reconciliation', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('keeps the five production-drift endpoints free of role-label authorization', async () => {
    const r = await client.query<{ fn: string; definition: string }>(`
      SELECT p.oid::regprocedure::text AS fn, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.oid::regprocedure::text = ANY($1::text[])
      ORDER BY 1
    `, [repairedFunctions]);

    expect(r.rows.map((row) => row.fn).sort()).toEqual([...repairedFunctions].sort());

    for (const row of r.rows) {
      expect(row.definition).not.toMatch(/membership_role\s+(?:NOT\s+)?IN\s*\([^)]*'(?:owner|admin)'/i);
      expect(row.definition).not.toMatch(/v_role\s*(?:=|<>|IN|NOT\s+IN)/i);
      expect(row.definition).not.toMatch(/role\s+(?:NOT\s+)?IN\s*\([^)]*'(?:owner|cashier|branch_manager)'/i);
      expect(row.definition).toContain("SET search_path TO 'public', 'pg_temp'");
    }
  });

  it('uses canonical capabilities for branch and shift mutation', async () => {
    const r = await client.query<{ fn: string; definition: string }>(`
      SELECT p.oid::regprocedure::text AS fn, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.oid::regprocedure::text = ANY($1::text[])
    `, [[
      'create_organization_branch(uuid,text,text,text,text)',
      'delete_branch_cascade(uuid)',
      'open_shift(uuid,numeric,text)',
    ]]);

    const definitions = new Map(r.rows.map((row) => [row.fn, row.definition]));
    expect(definitions.get('create_organization_branch(uuid,text,text,text,text)')).toContain("can_permission('branches.manage')");
    expect(definitions.get('delete_branch_cascade(uuid)')).toContain("can_permission('branches.manage')");
    expect(definitions.get('open_shift(uuid,numeric,text)')).toContain("can_permission('shifts.open')");
  });

  it('keeps branch access explicit/primary plus Super Admin only', async () => {
    const r = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef('public.user_may_access_branch(uuid)'::regprocedure) AS definition
    `);
    const definition = r.rows[0].definition;
    expect(definition).toContain('public.is_pos_admin()');
    expect(definition).toContain('public.user_branch_access');
    expect(definition).toContain('u.branch_id = p_branch_id');
    expect(definition).not.toContain('organization_members');
    expect(definition).not.toContain('membership_role');
  });
});
