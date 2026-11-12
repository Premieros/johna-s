import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20261025185720_pos_order_type_capabilities.sql');
const inverse = read('scripts/rollback/pos_order_type_permissions_20261025.sql');
const discountHandoff = read('supabase/migrations/20261028111145_discount_handoff_authority.sql');
const discountHandoffInverse = read('scripts/rollback/discount_handoff_authority_20261028.sql');
const baseline = JSON.parse(read('scripts/db/candidates/pos_order_type_permissions_baseline.json')) as {functions: Array<{signature: string; body_md5: string}>};
const roles = JSON.parse(read('scripts/db/candidates/pos_order_type_role_conversion.json')) as Array<{role: string; before: string[]; after: string[]}>;
const originals = [...JSON.parse(read('scripts/db/candidates/pos_order_type_original_print_target_defs.json')), ...JSON.parse(read('scripts/db/candidates/pos_order_type_original_order_defs.json'))] as Array<{proname: string; definition: string}>;
const inTransaction = (sql: string) => sql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

describe.skipIf(!local)('production-specific order-type rollback rehearsal — owned localhost only', () => {
  let db: pg.Client;
  beforeAll(async () => { db = openDb(url!); await db.connect(); await db.query('BEGIN'); });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  it('restores exact captured function digests and permissions, then reapplies without touching business rows', async () => {
    // Peel the later dependent repair before rehearsing the historical snapshot.
    // Keep the exact original digest assertions; reapply in forward order below.
    await db.query(inTransaction(discountHandoffInverse));
    // The migration chain formats the print function differently from production.
    // Rehearse its exact captured variant, in this rollback-only local transaction.
    for (const original of originals) {
      let definition = original.definition;
      const patches = migration.matchAll(/pg_get_functiondef\('([^']+)'::regprocedure\); v_old text:=\$old\$([\s\S]*?)\$old\$;[\s\S]*?EXECUTE replace\(v_def,v_old,\$new\$([\s\S]*?)\$new\$\);/g);
      for (const patch of patches) {
        if (patch[1].startsWith(`public.${original.proname}(`)) {
          expect(definition.includes(patch[2])).toBe(true);
          definition = definition.split(patch[2]).join(patch[3]);
        }
      }
      await db.query(definition);
    }
    for (const role of roles) {
      await db.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES($1,$1,$1,$2::jsonb,'global',true)
        ON CONFLICT(role) DO UPDATE SET permissions=excluded.permissions`, [role.role, JSON.stringify(role.after)]);
    }
    await db.query(inTransaction(inverse));
    const definitions = await db.query<{signature: string; body_md5: string}>(`SELECT p.oid::regprocedure::text signature,md5(p.prosrc) body_md5 FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY 1`, [baseline.functions.map(row => `public.${row.signature}`)]);
    expect(Object.fromEntries(definitions.rows.map(row => [row.signature, row.body_md5]))).toEqual(Object.fromEntries(baseline.functions.map(row => [row.signature, row.body_md5])));
    for (const role of roles) {
      const restored = await db.query('SELECT permissions FROM public.roles WHERE role=$1', [role.role]);
      expect(restored.rows[0].permissions).toEqual(role.before);
    }
    await db.query(inTransaction(migration));
    for (const role of roles) {
      const converted = await db.query('SELECT permissions FROM public.roles WHERE role=$1', [role.role]);
      expect(converted.rows[0].permissions).toEqual(role.after);
    }
    await db.query(inTransaction(discountHandoff));
  });
});
