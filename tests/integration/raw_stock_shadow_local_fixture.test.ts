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
    expect(candidate).toMatch(/Stage A is SHADOW ONLY/i);
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
    expect(tables.rows[0].branch).toBeNull(); // No duplicate branch-counter.
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
  it('measures TOTAL read-vs-write trade-off on synthetic negative-heavy data (diagnostic only)', async () => {
    // No performance assertion: runner/VM conditions vary and Stage B is
    // missing. We MUST NOT claim net DB savings from Stage A alone.
    await client.query('BEGIN');
    try {
      await client.query(`
        -- Both test tables are LOGGED and created within a rolled-back
        -- transaction. TEMP baseline would artificially undercount WAL
        -- compared with a real logged source table.
        CREATE TABLE private.stock_pressure_plain (
          raw_material_id uuid NOT NULL,
          branch_id uuid NOT NULL,
          warehouse_id uuid NOT NULL,
          quantity numeric NOT NULL,
          unit_cost numeric NOT NULL
        );
        CREATE TABLE private.stock_pressure_with_shadow
          (LIKE private.stock_pressure_plain INCLUDING ALL);
        CREATE INDEX ON private.stock_pressure_plain (raw_material_id,branch_id,warehouse_id);
        CREATE INDEX ON private.stock_pressure_with_shadow (raw_material_id,branch_id,warehouse_id);
        CREATE TRIGGER trg_stock_pressure_shadow
        AFTER INSERT OR UPDATE OR DELETE ON private.stock_pressure_with_shadow
        FOR EACH ROW EXECUTE FUNCTION private.sync_raw_stock_shadow_from_batch();
      `);

      type ExplainPlan = { 'Execution Time': number; WAL?: { 'WAL Bytes'?: number } };
      const explain = async (sql: string): Promise<ExplainPlan> => {
        const got = await client.query<{ 'QUERY PLAN': ExplainPlan[] }>(
          `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${sql}`,
        );
        return got.rows[0]['QUERY PLAN'][0];
      };
      const source = `SELECT
        '11111111-1111-4111-8111-111111111111'::uuid,
        '22222222-2222-4222-8222-222222222222'::uuid,
        '33333333-3333-4333-8333-333333333333'::uuid,
        -1::numeric, 0::numeric FROM generate_series(1, 1200)`;

      const baselineWrite = await explain(`INSERT INTO private.stock_pressure_plain
        (raw_material_id,branch_id,warehouse_id,quantity,unit_cost) ${source}`);
      const shadowWrite = await explain(`INSERT INTO private.stock_pressure_with_shadow
        (raw_material_id,branch_id,warehouse_id,quantity,unit_cost) ${source}`);
      // This simple synthetic probe does NOT model a full Stage B cutover.
      // Compare write WALs on the same logged storage type.
      const baselineRead = await explain(`
        SELECT COALESCE(SUM(quantity),0) FROM private.stock_pressure_plain
        WHERE raw_material_id='11111111-1111-4111-8111-111111111111'::uuid
          AND branch_id='22222222-2222-4222-8222-222222222222'::uuid
          AND warehouse_id='33333333-3333-4333-8333-333333333333'::uuid`);
      const warehouseRead = await explain(`
        SELECT quantity FROM private.raw_stock_warehouse_shadow
        WHERE raw_material_id='11111111-1111-4111-8111-111111111111'::uuid
          AND branch_id='22222222-2222-4222-8222-222222222222'::uuid
          AND warehouse_id='33333333-3333-4333-8333-333333333333'::uuid`);
      const stock = await client.query<{ quantity: string }>(`
        SELECT quantity::text FROM private.raw_stock_warehouse_shadow
        WHERE raw_material_id='11111111-1111-4111-8111-111111111111'::uuid
          AND branch_id='22222222-2222-4222-8222-222222222222'::uuid
          AND warehouse_id='33333333-3333-4333-8333-333333333333'::uuid`);
      expect(stock.rows[0].quantity).toBe('-1200');

      // Deliberately report *both* added write cost and potential read saving.
      // It would be misleading to report only the faster indexed lookup.
      console.info('RAW_STOCK_SHADOW_SYNTHETIC_PRESSURE_DIAGNOSTIC', JSON.stringify({
        batchRows: 1200,
        baselineWriteMs: baselineWrite['Execution Time'],
        addedShadowWriteMs: shadowWrite['Execution Time'],
        legacyFullSumReadMs: baselineRead['Execution Time'],
        indexedWarehouseReadMs: warehouseRead['Execution Time'],
        baselineWriteWalBytes: baselineWrite.WAL?.['WAL Bytes'] ?? null,
        shadowWriteWalBytes: shadowWrite.WAL?.['WAL Bytes'] ?? null,
        caveat: 'Synthetic logged tables; not a net-load benchmark: Stage B read-path rewrite absent',
      }));
    } finally {
      await client.query('ROLLBACK');
    }
  }, 30000);

});
