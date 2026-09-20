import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const expectedFunctions = [
  {
    name: 'can_execute_cloud_print_kind',
    args: 'p_kind text',
    hash: '2a9c54858eec90cbc82db420f87cd703',
  },
  {
    name: 'claim_cloud_print_jobs',
    args: 'p_branch_id uuid, p_agent_id uuid, p_limit integer',
    hash: '230529255ab7fe21df1eb1ca0f07f1b6',
  },
  {
    name: 'complete_cloud_print_job',
    args: 'p_job_id uuid, p_agent_id uuid, p_success boolean, p_error text',
    hash: '8492141102176d4fddf30cb0d5d42cb1',
  },
  {
    name: 'start_cloud_print_job',
    args: 'p_job_id uuid, p_agent_id uuid',
    hash: 'fae5a0b45bb5d0646100996bbb153fad',
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

  it('keeps the exact case-sensitive RPC implementations used by the frozen Smouha v7 agent', async () => {
    const rows = await client.query<{
      name: string;
      args: string;
      definition_hash: string;
    }>(`
      SELECT p.proname AS name,
             pg_get_function_identity_arguments(p.oid) AS args,
             md5(pg_get_functiondef(p.oid)) AS definition_hash
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
        actual?.definition_hash,
        `${item.name} changed; frozen Smouha v7 compatibility requires explicit migration approval`,
      ).toBe(item.hash);
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
