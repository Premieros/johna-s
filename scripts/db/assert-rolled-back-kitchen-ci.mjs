import pg from 'pg';
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Owned CI only');
const url = new URL(process.env.SUPABASE_DB_URL || '');
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Loopback only');
const db = new pg.Client({connectionString: url.toString()});
await db.connect();
try {
  const r = await db.query("SELECT md5(prosrc) body FROM pg_proc WHERE oid='public._send_to_kitchen_core_20260914(uuid,uuid)'::regprocedure");
  if (r.rows[0]?.body !== 'd9d480eeaf2d1c3afecdac1666e3a0bd') throw new Error('Unexpected deployed kitchen core');
  const h = await db.query("SELECT to_regprocedure('public._kitchen_dispatch_component_plans(uuid,jsonb)') IS NOT NULL present");
  if (h.rows[0].present) throw new Error('Rolled-back optimization must remain disabled');
  console.info('Confirmed production rollback bindings; no SQL optimization reactivation');
} finally { await db.end(); }
