// Disposable A0 compatibility probe. Always creates an in-memory database.
// No connection string/.env input, network client, production data or retry/skip.
// Usage: node branch-hub/experiments/probe-pglite-schema.mjs /path/to/@electric-sql/pglite
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const packageRoot = process.argv[2];
if (!packageRoot || (process.argv.length !== 3 && !(process.argv.length === 4 && process.argv[3] === '--financial-boundary')) || /:\/\//.test(packageRoot)) throw new Error('Supply an installed PGlite package directory, never a database URL');
const load = relative => import(pathToFileURL(join(resolve(packageRoot), 'dist', relative)).href);
const { PGlite } = await load('index.js');
const { pgcrypto } = await load('contrib/pgcrypto.js');
const { uuid_ossp } = await load('contrib/uuid_ossp.js');
const root = fileURLToPath(new URL('../../', import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, 'uuid-ossp': uuid_ossp } });
const packageVersion = JSON.parse(readFileSync(join(resolve(packageRoot), 'package.json'), 'utf8')).version;
const migrationDigest = createHash('sha256');
const report = { packageVersion, prototypeOnly: true, productionContacted: false, authStubOnly: true, applied: 0, failedFile: null };
let file = 'supabase/ci/stub_auth.sql';
try {
  // Same tracking relation used by scripts/db/apply-migration.js in owned CI.
  await db.exec(`CREATE TABLE public.schema_migrations (
    id bigserial PRIMARY KEY, version text NOT NULL UNIQUE, name text NOT NULL,
    checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  await db.exec(readFileSync(join(root, file), 'utf8'));
  for (const name of readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    file = 'supabase/migrations/' + name;
    const sql = readFileSync(join(root, file), 'utf8');
    migrationDigest.update(name).update('\0').update(sql).update('\0');
    await db.exec(sql);
    await db.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
      [name.replace(/\.sql$/i, ''), name, createHash('sha256').update(sql).digest('hex')]);
    report.applied += 1;
  }
  report.schemaReplayComplete = true;
  report.migrationSourceSha256 = migrationDigest.digest('hex');
  report.installedExtensions = (await db.query('SELECT extname, extversion FROM pg_extension ORDER BY extname')).rows;
  report.businessParityTested = false;
  if (process.argv[3] === '--financial-boundary') {
    report.stage = 'financial-boundary';
    file = null;
    const { testFinancialBoundary } = await import('./financial-boundary.mjs');
    report.financialBoundary = await testFinancialBoundary(db);
  }
  report.durabilityTested = false;
} catch (error) {
  report.failedFile = file;
  report.sqlstate = error.code;
  report.error = String(error.message).slice(0, 250);
  if (!report.schemaReplayComplete) report.schemaReplayComplete = false;
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify(report, null, 2));
  await db.close();
}
