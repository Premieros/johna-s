import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Opt-in ONLY against a disposable, LOCAL PostgreSQL database.
// Normal integration suites skip this destructive schema experiment.
// GitHub's existing isolated PostgreSQL service may explicitly set this URL
// after it has run every canonical DB integration test. Do not use production.
const connectionString = process.env.RAW_STOCK_SHADOW_LOCAL_DB_URL || '';
let isLocal = false;
try {
  const parsed = new URL(connectionString);
  isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    && ['postgres:', 'postgresql:'].includes(parsed.protocol)
    && !connectionString.includes('azzdesuowpdcoflmyezn')
    && !connectionString.includes('supabase.co');
} catch {
  isLocal = false;
}

describe.skipIf(!isLocal)('raw stock shadow transaction SQL (disposable local DB only)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString });
    await client.connect();
    // Explicitly exercise the *exact candidate* against the existing local
    // schema (it is deliberately not picked up by any migration runner).
    // This is safe only in a throwaway PostgreSQL database: it creates
    // private schema objects and an AFTER trigger on the local public table.
    // The CI database is destroyed at the end of this GitHub job.
    const candidate = readFileSync(
      'scripts/experiments/raw_stock_shadow_state_candidate_20261012.sql',
      'utf8',
    );
    expect(candidate).toContain('STAGE A IS SHADOW ONLY');
    expect(candidate.trimEnd().endsWith('COMMIT;')).toBe(true);
    await client.query(candidate);
  }, 30000);

  afterAll(async () => {
    if (client) await client.end();
  });

  it('applies a negative-first purchase, stock count, repricing, scope move and rollback fixture', async () => {
    const tables = await client.query<{ branch: string | null; warehouse: string | null }>(
      "SELECT to_regclass('private.raw_stock_branch_shadow')::text AS branch, " +
      "to_regclass('private.raw_stock_warehouse_shadow')::text AS warehouse",
    );
    expect(tables.rows[0].branch).toBe('private.raw_stock_branch_shadow');
    expect(tables.rows[0].warehouse).toBe('private.raw_stock_warehouse_shadow');

    const fixture = readFileSync(
      'scripts/experiments/raw_stock_shadow_rollback_fixture_20261012.sql',
      'utf8',
    );
    expect(fixture.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    await client.query(fixture);
  }, 30000);

  it('rolls synthetic inserts back without changing any persisted shadow row', async () => {
    const got = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM private.raw_stock_warehouse_shadow " +
      "WHERE raw_material_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', " +
      "'ffffffff-ffff-4fff-8fff-ffffffffffff')",
    );
    expect(got.rows[0].count).toBe('0');
  });
});
