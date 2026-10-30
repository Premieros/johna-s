import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const signatures = [
  'public._prepare_kitchen_sale_settlement(uuid,uuid,uuid,jsonb)',
  'public.enqueue_cloud_open_order_print(uuid,jsonb,text)',
];
const script = (path: string) => readFileSync(path, 'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');

describe.skipIf(!dbUrl)('unsent checkout guarded recovery', () => {
  it('restores original definitions exactly and preserves all security metadata on reapply', async () => {
    const c = openDb(dbUrl!);
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='8s'");
      const snapshot = async () => (await c.query(`SELECT p.oid::regprocedure::text signature,
        pg_get_functiondef(p.oid) definition,p.prosecdef,p.provolatile,p.proowner,p.proacl,p.proconfig
        FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY p.oid`, [signatures])).rows;
      const installed = await snapshot();
      expect(installed).toHaveLength(2);
      expect(installed.every(r => r.definition.includes('ORDER_FULL_SEND_REQUIRED_20261030'))).toBe(true);
      await c.query(script('scripts/rollback/order_unsent_checkout_emergency_20261030.sql'));
      const original = await snapshot();
      expect(original.every(r => !r.definition.includes('ORDER_FULL_SEND_REQUIRED_20261030'))).toBe(true);
      expect(original.find(r => r.signature.includes('enqueue_cloud'))?.definition).not.toContain('WHERE o.id=p_order_id FOR UPDATE;');
      const security = (rows: typeof installed) => rows.map(({ definition, ...metadata }) => { void definition; return metadata; });
      expect(security(original)).toEqual(security(installed));
      await c.query(script('supabase/migrations/20261030211200_order_unsent_checkout_emergency.sql'));
      expect(await snapshot()).toEqual(installed);
      await c.query('SAVEPOINT duplicate_guard');
      await expect(c.query(script('supabase/migrations/20261030211200_order_unsent_checkout_emergency.sql'))).rejects.toThrow('Order guard source drift');
      await c.query('ROLLBACK TO SAVEPOINT duplicate_guard');
      expect(await snapshot()).toEqual(installed);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  });
});
