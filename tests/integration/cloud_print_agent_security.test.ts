import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const functions = [
  ['enqueue_cloud_kitchen_print', 'p_branch_id uuid, p_station_code text, p_payload jsonb, p_idempotency_key text'],
  ['enqueue_cloud_receipt_print', 'p_sale_id uuid, p_approval_request_id uuid, p_payload jsonb, p_idempotency_key text'],
  ['claim_cloud_print_jobs', 'p_branch_id uuid, p_agent_id uuid, p_limit integer'],
  ['start_cloud_print_job', 'p_job_id uuid, p_agent_id uuid'],
  ['complete_cloud_print_job', 'p_job_id uuid, p_agent_id uuid, p_success boolean, p_error text'],
] as const;

describe.skipIf(!dbUrl)('cloud print agent security contract', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('forces RLS and denies authenticated direct queue writes', async () => {
    const row = await client.query<{
      rls: boolean;
      force_rls: boolean;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(`
      SELECT c.relrowsecurity AS rls,
             c.relforcerowsecurity AS force_rls,
             has_table_privilege('authenticated', c.oid, 'SELECT') AS can_select,
             has_table_privilege('authenticated', c.oid, 'INSERT') AS can_insert,
             has_table_privilege('authenticated', c.oid, 'UPDATE') AS can_update,
             has_table_privilege('authenticated', c.oid, 'DELETE') AS can_delete
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'cloud_print_jobs'
    `);

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].rls).toBe(true);
    expect(row.rows[0].force_rls).toBe(true);
    expect(row.rows[0].can_select).toBe(true);
    expect(row.rows[0].can_insert).toBe(false);
    expect(row.rows[0].can_update).toBe(false);
    expect(row.rows[0].can_delete).toBe(false);
  });

  it('hardens all queue RPCs and exposes them only to authenticated clients', async () => {
    for (const [name, args] of functions) {
      const row = await client.query<{
        security_definer: boolean;
        config: string[] | null;
        authenticated_execute: boolean;
        anon_execute: boolean;
      }>(
        `SELECT p.prosecdef AS security_definer,
                p.proconfig AS config,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = $1
           AND pg_get_function_identity_arguments(p.oid) = $2`,
        [name, args],
      );

      expect(row.rows, `${name}(${args})`).toHaveLength(1);
      expect(row.rows[0].security_definer, `${name} SECURITY DEFINER`).toBe(true);
      expect(row.rows[0].config ?? [], `${name} search_path`).toContain('search_path=public, pg_temp');
      expect(row.rows[0].authenticated_execute, `${name} authenticated execute`).toBe(true);
      expect(row.rows[0].anon_execute, `${name} anon execute`).toBe(false);
    }
  });

  it('keeps print retry separate from order, payment, and inventory business mutations', async () => {
    const rows = await client.query<{ name: string; definition: string }>(
      `SELECT p.proname AS name, lower(pg_get_functiondef(p.oid)) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [[
        'claim_cloud_print_jobs',
        'start_cloud_print_job',
        'complete_cloud_print_job',
      ]],
    );

    const forbidden = [
      'send_to_kitchen(',
      'process_sale',
      'deduct_sale_unit_inventory(',
      'inventory_movements',
      'payment_transactions',
    ];
    for (const row of rows.rows) {
      for (const needle of forbidden) {
        expect(row.definition, `${row.name} must not replay ${needle}`).not.toContain(needle);
      }
    }
  });
});
