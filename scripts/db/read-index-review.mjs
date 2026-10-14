import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const indexes = JSON.parse(readFileSync(new URL('../experiments/database_read_indexes_20261014.json', import.meta.url), 'utf8'));
import { validateTarget, expectedProject } from './read-index-target.mjs';
export { validateTarget, expectedProject } from './read-index-target.mjs';

export const securityCatalog = `SELECT
  (SELECT md5(string_agg(pg_get_functiondef(p.oid)||COALESCE(p.proacl::text,'')||p.proowner::text,',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f') functions,
  (SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY schemaname,tablename,policyname)) FROM pg_policies p WHERE schemaname IN ('public','private')) policies,
  (SELECT md5(string_agg(pg_get_triggerdef(t.oid)||t.tgenabled::text,',' ORDER BY t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') triggers,
  (SELECT md5(string_agg(pg_get_constraintdef(c.oid),',' ORDER BY c.oid)) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') constraints,
  (SELECT md5(string_agg(c.oid::text||c.relrowsecurity::text||COALESCE(c.relacl::text,''),',' ORDER BY c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p')) tables`;

export async function applyReviewedIndexes(db, selected = indexes) {
  // Dedicated connection; each concurrent DDL runs OUTSIDE a transaction.
  // No function/RLS/queue/data changes; one index at a time per table.
  await db.query("SET lock_timeout='2s'");
  await db.query("SET statement_timeout='60s'");
  const before = (await db.query(securityCatalog)).rows;
  // Fail closed before the first DDL, including existing/invalid conflicting names.
  for (const spec of selected) {
    if (!indexes.some(x => x.name === spec.name && x.sql === spec.sql && x.table === spec.table)) throw new Error('Unreviewed index');
    if ((await db.query('SELECT to_regclass($1) present', [`public.${spec.name}`])).rows[0].present) throw new Error(`Existing index requires reconciliation: ${spec.name}`);
  }
  const built = [];
  try {
    for (const spec of selected) {
      await db.query(spec.sql.replace(/^CREATE INDEX /, 'CREATE INDEX CONCURRENTLY '));
      const row = (await db.query(`SELECT i.indisvalid,i.indisready FROM pg_index i WHERE i.indexrelid=to_regclass($1)`, [`public.${spec.name}`])).rows[0];
      if (!row?.indisvalid || !row?.indisready) throw new Error(`Invalid index: ${spec.name}`);
      built.push(spec.name);
    }
    if (JSON.stringify((await db.query(securityCatalog)).rows) !== JSON.stringify(before)) throw new Error('Security/catalog drift: stop for review');
    return { built };
  } catch (error) {
    // Concurrent DDL is not atomic. Never retry, remove an index or terminate
    // writers automatically. Report the successful prefix for explicit review.
    throw Object.assign(new Error('Index build stopped; inspect valid/invalid index state before continuing'), { cause: error, built });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(x => !['--plan', '--apply'].includes(x)) || args.includes('--plan') && args.includes('--apply')) throw new Error('Use --plan OR --apply');
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ project: expectedProject, apply: false, sql: indexes.map(x => x.sql.replace(/^CREATE INDEX /, 'CREATE INDEX CONCURRENTLY ')) }, null, 2));
    return;
  }
  const rawUrl = process.env.SUPABASE_DB_URL;
  if (!rawUrl) throw new Error('Dedicated database connection is unavailable');
  validateTarget(rawUrl, process.env, true);
  // pg parses sslmode=verify-full and sslrootcert from the connection URL.
  // Never override certificate verification with rejectUnauthorized:false.
  const db = new pg.Client({ connectionString: rawUrl, application_name: 'johnas-reviewed-read-indexes' });
  await db.connect();
  try { console.log(JSON.stringify(await applyReviewedIndexes(db))); }
  finally { await db.end(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); if (error.built) console.error(JSON.stringify({ built: error.built })); process.exitCode = 1; });
}
