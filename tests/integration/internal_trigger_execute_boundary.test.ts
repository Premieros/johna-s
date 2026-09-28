import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('internal trigger execute boundary', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('keeps the three helpers SECURITY DEFINER trigger functions but removes client EXECUTE', async () => {
    const result = await client.query<{
      proname: string;
      security_definer: boolean;
      return_type: string;
      public_exec: boolean;
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
    }>(`
      SELECT
        p.proname,
        p.prosecdef AS security_definer,
        p.prorettype::regtype::text AS return_type,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          '_raw_inventory_actual_avg_cost_guard',
          '_raw_price_oversold_batch_from_fifo',
          'treasury_accounts_fill_model_defaults'
        )
      ORDER BY p.proname
    `);

    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.security_definer).toBe(true);
      expect(row.return_type).toBe('trigger');
      expect(row.public_exec).toBe(false);
      expect(row.anon_exec).toBe(false);
      expect(row.auth_exec).toBe(false);
      expect(row.service_exec).toBe(true);
    }
  });

  it('keeps every hardened helper attached to an enabled table trigger', async () => {
    const result = await client.query<{
      proname: string;
      trigger_count: string;
      disabled_count: string;
    }>(`
      SELECT
        p.proname,
        count(*)::text AS trigger_count,
        count(*) FILTER (WHERE t.tgenabled = 'D')::text AS disabled_count
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE NOT t.tgisinternal
        AND n.nspname = 'public'
        AND p.proname IN (
          '_raw_inventory_actual_avg_cost_guard',
          '_raw_price_oversold_batch_from_fifo',
          'treasury_accounts_fill_model_defaults'
        )
      GROUP BY p.proname
      ORDER BY p.proname
    `);

    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(Number(row.trigger_count)).toBeGreaterThan(0);
      expect(Number(row.disabled_count)).toBe(0);
    }
  });
});
