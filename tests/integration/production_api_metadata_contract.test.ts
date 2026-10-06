import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
const dbUrl = getDbUrl();
const contract = JSON.parse(readFileSync('supabase/api-contract.json', 'utf8'));
describe.skipIf(!dbUrl)('production metadata contract (isolated database only)', () => {
  let client: pg.Client;
  beforeAll(async () => { client = openDb(dbUrl); await client.connect(); });
  afterAll(async () => { await client?.end(); });
  async function check(payload: unknown) {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE anon');
      const { rows } = await client.query('SELECT public._production_api_contract_v1($1::jsonb) AS result', [JSON.stringify(payload)]);
      return rows[0].result;
    } finally { await client.query('ROLLBACK'); }
  }
  it('verifies every current frontend signature/relation as anon without data access', async () => {
    const result = await check(contract);
    expect(result.valid).toBe(true);
    expect(result.rpcs.filter((r: { present: boolean }) => !r.present)).toEqual([]);
    expect(result.tables.filter((r: { present: boolean }) => !r.present)).toEqual([]);
    expect(result.rpcs).toHaveLength(contract.rpcs.length);
    expect(result.tables).toHaveLength(contract.tables.length);
  });
  it('uses invoker/catalog access without granting access to operational data', async () => {
    const { rows } = await client.query(`SELECT prosecdef, provolatile, proconfig FROM pg_proc
      WHERE oid='public._production_api_contract_v1(jsonb)'::regprocedure`);
    expect(rows[0]).toMatchObject({ prosecdef: false, provolatile: 's', proconfig: ['search_path=pg_catalog'] });
  });
  it('fails closed for missing objects and wrong input argument names', async () => {
    const result = await check({ rpcs: [{ name: 'set_kitchen_status', params: ['nonexistent'] }], tables: ['missing_parity_table'] });
    expect(result).toMatchObject({ valid: true, rpcs: [{ present: false }], tables: [{ present: false }] });
  });
  it.each([null, {}, { rpcs: {}, tables: [] }, { rpcs: [], tables: [] },
    { ...contract, tables: ['orders', 'orders'] },
    { ...contract, rpcs: [contract.rpcs[0], contract.rpcs[0]] },
    { ...contract, rpcs: [{ name: 'send_to_kitchen', params: ['order_id', 'order_id'] }] },
    { ...contract, tables: ["orders; DELETE FROM orders"] },
    { ...contract, tables: Array(201).fill('orders') },
    { ...contract, padding: 'x'.repeat(100001) },
  ])('rejects malformed, duplicated, oversized or SQL-shaped input %# without exceptions', async payload => {
    expect(await check(payload)).toEqual({ version: 1, valid: false });
  });
  it('matches defaults, OUT arguments and ambiguity without executing the functions', async () => {
    await client.query(`CREATE FUNCTION public.parity_fixture(p_a integer, p_b text DEFAULT '') RETURNS TABLE(value integer)
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'must never execute'; END $$`);
    try {
      const payload = { rpcs: [{ name: 'parity_fixture', params: ['a'] }], tables: ['orders'] };
      expect((await check(payload)).rpcs[0].present).toBe(true);
      await client.query(`CREATE FUNCTION public.parity_fixture(p_a text) RETURNS integer
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'must never execute'; END $$`);
      expect((await check(payload)).rpcs[0].present).toBe(false);
    } finally {
      await client.query('DROP FUNCTION IF EXISTS public.parity_fixture(integer,text), public.parity_fixture(text)');
    }
  });
});
