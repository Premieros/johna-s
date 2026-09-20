import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const expected = [
  {
    name: 'can_execute_cloud_print_kind',
    args: 'p_kind text',
    hash: '0c5c5cb7868db249588f6ff715e2e8c0',
  },
  {
    name: 'claim_cloud_print_jobs',
    args: 'p_branch_id uuid, p_agent_id uuid, p_limit integer',
    hash: '7bb98c35d47f682c319e76ec0b0a8c9d',
  },
  {
    name: 'complete_cloud_print_job',
    args: 'p_job_id uuid, p_agent_id uuid, p_success boolean, p_error text',
    hash: 'efa07471fccdbb94c2ca870eac95d374',
  },
  {
    name: 'start_cloud_print_job',
    args: 'p_job_id uuid, p_agent_id uuid',
    hash: '7c37d00fc5370c64964f56ef66aec347',
  },
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

  it('keeps the RPC implementations used by the frozen Smouha v7 agent unchanged', async () => {
    const rows = await client.query<{
      name: string;
      args: string;
      definition_hash: string;
    }>(`
      SELECT p.proname AS name,
             pg_get_function_identity_arguments(p.oid) AS args,
             md5(regexp_replace(lower(pg_get_functiondef(p.oid)), '\\s+', ' ', 'g')) AS definition_hash
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])
      ORDER BY p.proname
    `, [expected.map((item) => item.name)]);

    expect(rows.rows).toHaveLength(expected.length);
    for (const item of expected) {
      const actual = rows.rows.find((row) => row.name === item.name && row.args === item.args);
      expect(actual, `${item.name}(${item.args}) must exist for Smouha v7`).toBeDefined();
      expect(actual?.definition_hash, `${item.name} changed; frozen Smouha v7 compatibility requires explicit migration approval`).toBe(item.hash);
    }
  });

  it('keeps the queue fields required by the Smouha v7 agent', async () => {
    const rows = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cloud_print_jobs'
        AND column_name = ANY($1::text[])
      ORDER BY column_name
    `, [[
      'id',
      'branch_id',
      'kind',
      'station_code',
      'payload',
      'status',
      'claimed_agent_id',
      'attempts',
      'created_at'
    ]]);

    const present = new Set(rows.rows.map((row) => row.column_name));
    for (const required of [
      'id',
      'branch_id',
      'kind',
      'station_code',
      'payload',
      'status',
      'claimed_agent_id',
      'attempts',
      'created_at',
    ]) {
      expect(present.has(required), `cloud_print_jobs.${required} is required by Smouha v7`).toBe(true);
    }
  });
});
