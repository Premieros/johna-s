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

  it('records Windows acceptance as submitted and never as physical print success', async () => {
    const rows = await client.query<{ name: string; definition: string }>(
      `SELECT p.proname AS name, lower(pg_get_functiondef(p.oid)) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [['record_sale_print', 'complete_cloud_print_job']],
    );

    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.definition, `${row.name} physical truth`).toMatch(/'physical_print_confirmed'(?:::text)?,\s*false/);
      expect(row.definition, `${row.name} must never claim physical confirmation`).not.toMatch(/'physical_print_confirmed'(?:::text)?,\s*true/);
    }

    const complete = rows.rows.find((row) => row.name === 'complete_cloud_print_job');
    expect(complete?.definition).toMatch(/status\s*=\s*'submitted'(?:::text)?/);
    expect(complete?.definition).not.toMatch(/status\s*=\s*'printed'(?:::text)?/);
    expect(complete?.definition).toMatch(/'status'(?:::text)?,\s*'submitted'(?:::text)?/);

    const statusConstraint = await client.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'cloud_print_jobs'
        AND c.conname = 'cloud_print_jobs_status_check'
    `);
    expect(statusConstraint.rows).toHaveLength(1);
    expect(statusConstraint.rows[0].definition.toLowerCase()).toContain('submitted');
  });

  it('deduplicates a retryable failed receipt job until its retry window is exhausted', async () => {
    const index = await client.query<{ predicate: string }>(`
      SELECT lower(pg_get_expr(i.indpred, i.indrelid)) AS predicate
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'cloud_print_jobs'
        AND idx.relname = 'uq_cloud_print_active_receipt_sale'
    `);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].predicate).toMatch(/status\s*=\s*'failed'::text/);
    expect(index.rows[0].predicate).toMatch(/attempts\s*<\s*5/);

    const rpc = await client.query<{ definition: string }>(`
      SELECT lower(pg_get_functiondef(p.oid)) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'enqueue_cloud_receipt_print'
        AND pg_get_function_identity_arguments(p.oid) = 'p_sale_id uuid, p_approval_request_id uuid, p_payload jsonb, p_idempotency_key text'
    `);
    expect(rpc.rows).toHaveLength(1);
    expect(rpc.rows[0].definition).toMatch(/status\s*=\s*'failed'(?:::text)?/);
    expect(rpc.rows[0].definition).toMatch(/attempts\s*<\s*5/);
    expect(rpc.rows[0].definition).toContain('v_job := v_existing');
  });
});
