import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

// Opt-in only, after applying the candidate to a DISPOSABLE local PostgreSQL.
// NEVER point this fixture to the live Supabase project or a hosted DB.
// CI without this explicit local URL skips this test; a green CI does NOT
// claim that the new SQL design has been executed against a real database.
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

describe.skipIf(!isLocal)('raw stock shadow transactional SQL fixture (local-only)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  it('runs the same trigger on synthetic temporary batches and rolls every change back', async () => {
    const tables = await client.query<{ branch: string | null; warehouse: string | null }>(
      "SELECT to_regclass('private.raw_stock_branch_shadow')::text AS branch, " +
      "to_regclass('private.raw_stock_warehouse_shadow')::text AS warehouse",
    );
    expect(tables.rows[0].branch).toBe('private.raw_stock_branch_shadow');
    expect(tables.rows[0].warehouse).toBe('private.raw_stock_warehouse_shadow');

    const sql = readFileSync(
      'scripts/experiments/raw_stock_shadow_rollback_fixture_20261012.sql',
      'utf8',
    );
    expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);

    // A failed DO assertion rejects the test. The fixture creates only a temp
    // table and shadow deltas; normal success/rollback leaves no test records.
    await client.query(sql);
  });
});
