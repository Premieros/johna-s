import { readFileSync } from 'node:fs';
import type pg from 'pg';

/** Installs only inside the caller's existing owned/local rollback transaction. */
export async function installApprovedRawWriterFixture(db: pg.Client, url: string): Promise<void> {
  if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) {
    throw new Error('APPROVED_RAW_FIXTURE_REQUIRES_OWNED_LOCALHOST');
  }
  const installed=(await db.query("SELECT to_regprocedure('private.finalize_raw_last_price_branch(uuid)') IS NOT NULL installed")).rows[0].installed;
  if (installed) {
    const expected=JSON.parse(readFileSync('tests/fixtures/raw-last-price-operational-bindings.json','utf8')) as Record<string,string>;
    for (const [signature,fingerprint] of Object.entries(expected)) {
      const actual=(await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) fingerprint',[signature])).rows[0].fingerprint;
      if (actual!==fingerprint) throw new Error('APPROVED_RAW_RELEASE_BINDING_DRIFT '+signature);
    }
    return;
  }
  // SAVEPOINT fails outside an explicit transaction, before any schema changes.
  await db.query('SAVEPOINT approved_raw_fixture_guard');
  await db.query('RELEASE SAVEPOINT approved_raw_fixture_guard');
  for (const path of [
    'scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql',
    'scripts/db/candidates/raw_last_price_shared_resolver_20261104.sql',
    'scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql',
    'scripts/db/candidates/approved_raw_cost_v2_coordinate_gate_20261031.sql',
    'scripts/db/candidates/raw_last_price_kitchen_snapshot_20261104.sql',
    'scripts/db/candidates/raw_last_price_retire_legacy_tools_20261104.sql',
    'scripts/db/candidates/raw_last_price_new_branch_defaults_20261104.sql',
    'scripts/db/candidates/raw_last_price_backend_compatibility_20261104.sql',
    'scripts/db/candidates/raw_last_price_transfer_context_20261104.sql',
  ]) {
    await db.query(readFileSync(path,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
  }
}

export async function activateApprovedRawFixture(db: pg.Client, branch: string, warehouse: string, raw: string): Promise<void> {
  await db.query(`INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,warehouse_id,raw_material_id,activation_note)
    VALUES($1,$2,$3,'owned rollback-only lifecycle fixture') ON CONFLICT DO NOTHING`, [branch,warehouse,raw]);
}

/** Only empty/owned fixture branches: exercises newly created fallback raws. */
export async function activateApprovedBranchFixture(db: pg.Client, branch: string): Promise<void> {
  await db.query(`INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,activation_note)
    VALUES($1,'owned empty branch fixture only') ON CONFLICT DO NOTHING`,[branch]);
}
