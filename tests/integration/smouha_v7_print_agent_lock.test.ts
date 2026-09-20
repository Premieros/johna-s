import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const expectedFunctions = [
  {
    name: 'can_execute_cloud_print_kind',
    args: 'p_kind text',
    normalizedHash: '0c5c5cb7868db249588f6ff715e2e8c0',
    exactLiterals: [
      "'kitchen'",
      "'receipt'",
      "'report'",
      "'settings.manage'",
      "'pos.print_kitchen'",
      "'pos.receipt.print'",
    ],
  },
  {
    name: 'claim_cloud_print_jobs',
    args: 'p_branch_id uuid, p_agent_id uuid, p_limit integer',
    normalizedHash: '7bb98c35d47f682c319e76ec0b0a8c9d',
    exactLiterals: [
      "'AUTH_REQUIRED'",
      "'AGENT_ID_REQUIRED'",
      "'BRANCH_MISMATCH'",
      "'CLAIM_LEASE_EXPIRED'",
      "'PRINT_OUTCOME_UNKNOWN'",
      "'pending'",
      "'failed'",
      "'claimed'",
      "'printing'",
      "'45 seconds'",
    ],
  },
  {
    name: 'complete_cloud_print_job',
    args: 'p_job_id uuid, p_agent_id uuid, p_success boolean, p_error text',
    normalizedHash: 'efa07471fccdbb94c2ca870eac95d374',
    exactLiterals: [
      "'AUTH_REQUIRED'",
      "'JOB_NOT_FOUND'",
      "'PERMISSION_DENIED'",
      "'BRANCH_MISMATCH'",
      "'CLAIM_MISMATCH'",
      "'PRINT_CALLBACK_TIMEOUT'",
      "'PRINT_OUTCOME_UNKNOWN'",
      "'PRINT_SEQUENCE_CHANGED'",
      "'INVALID_APPROVAL'",
      "'submitted'",
      "'failed'",
      "'physical_print_confirmed'",
    ],
  },
  {
    name: 'start_cloud_print_job',
    args: 'p_job_id uuid, p_agent_id uuid',
    normalizedHash: '7c37d00fc5370c64964f56ef66aec347',
    exactLiterals: [
      "'AUTH_REQUIRED'",
      "'JOB_NOT_FOUND'",
      "'PERMISSION_DENIED'",
      "'BRANCH_MISMATCH'",
      "'CLAIM_MISMATCH'",
      "'PRINT_SEQUENCE_CHANGED'",
      "'INVALID_APPROVAL'",
      "'printing'",
      "'45 seconds'",
    ],
  },
] as const;

const expectedColumns = [
  { column_name: 'attempts', data_type: 'integer', is_nullable: 'NO' },
  { column_name: 'branch_id', data_type: 'uuid', is_nullable: 'NO' },
  { column_name: 'claimed_agent_id', data_type: 'uuid', is_nullable: 'YES' },
  { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
  { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
  { column_name: 'kind', data_type: 'text', is_nullable: 'NO' },
  { column_name: 'payload', data_type: 'jsonb', is_nullable: 'NO' },
  { column_name: 'station_code', data_type: 'text', is_nullable: 'NO' },
  { column_name: 'status', data_type: 'text', is_nullable: 'NO' },
] as const;

describe.skipIf(!dbUrl)('Smouha v7 print-agent frozen compatibility contract', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('keeps the RPC structure and exact observable literals used by the frozen Smouha v7 agent', async () => {
    const rows = await client.query<{
      name: string;
      args: string;
      normalized_hash: string;
      definition: string;
    }>(`
      SELECT p.proname AS name,
             pg_get_function_identity_arguments(p.oid) AS args,
             md5(regexp_replace(lower(pg_get_functiondef(p.oid)), '\\s+', ' ', 'g')) AS normalized_hash,
             pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])
      ORDER BY p.proname
    `, [expectedFunctions.map((item) => item.name)]);

    expect(rows.rows).toHaveLength(expectedFunctions.length);
    for (const item of expectedFunctions) {
      const actual = rows.rows.find((row) => row.name === item.name && row.args === item.args);
      expect(actual, `${item.name}(${item.args}) must exist for Smouha v7`).toBeDefined();
      expect(
        actual?.normalized_hash,
        `${item.name} structure changed; frozen Smouha v7 compatibility requires explicit migration approval`,
      ).toBe(item.normalizedHash);
      for (const literal of item.exactLiterals) {
        expect(
          actual?.definition.includes(literal),
          `${item.name} observable literal ${literal} changed; Smouha v7 contract must remain compatible`,
        ).toBe(true);
      }
    }
  });

  it('keeps queue field names, types, and nullability required by the Smouha v7 agent', async () => {
    const rows = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cloud_print_jobs'
        AND column_name = ANY($1::text[])
      ORDER BY column_name
    `, [expectedColumns.map((item) => item.column_name)]);

    expect(rows.rows).toHaveLength(expectedColumns.length);
    expect(rows.rows).toEqual(expectedColumns);
  });
});
