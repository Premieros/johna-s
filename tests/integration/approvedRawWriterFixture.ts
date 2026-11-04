import { readFileSync } from 'node:fs';
import type pg from 'pg';

/** Installs only inside the caller's existing owned/local rollback transaction. */
export async function installApprovedRawWriterFixture(db: pg.Client, url: string): Promise<void> {
  if (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) {
    throw new Error('APPROVED_RAW_FIXTURE_REQUIRES_OWNED_LOCALHOST');
  }
  // SAVEPOINT fails outside an explicit transaction, before any schema changes.
  await db.query('SAVEPOINT approved_raw_fixture_guard');
  await db.query('RELEASE SAVEPOINT approved_raw_fixture_guard');
  for (const path of [
    'scripts/db/candidates/approved_raw_cost_engine_minimal_storage_20261031.sql',
    'scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql',
    'scripts/db/candidates/approved_raw_cost_v2_coordinate_gate_20261031.sql',
  ]) {
    await db.query(readFileSync(path,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
  }
}

export async function activateApprovedRawFixture(db: pg.Client, branch: string, warehouse: string, raw: string): Promise<void> {
  await db.query(`INSERT INTO private.raw_cost_v2_activated_coordinates(branch_id,warehouse_id,raw_material_id,activation_note)
    VALUES($1,$2,$3,'owned rollback-only lifecycle fixture') ON CONFLICT DO NOTHING`, [branch,warehouse,raw]);
}
