// Development fixture only: fresh in-memory PostgreSQL, never a URL or .env.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export async function createCanonicalMemoryDatabase(packageRoot) {
  if (!packageRoot || /:\/\//.test(packageRoot)) throw new Error('Expected package directory, never a database URL');
  const load = relative => import(pathToFileURL(join(resolve(packageRoot), 'dist', relative)).href);
  const { PGlite } = await load('index.js');
  const { pgcrypto } = await load('contrib/pgcrypto.js');
  const { uuid_ossp } = await load('contrib/uuid_ossp.js');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const readSql=relative=>{const sql=readFileSync(join(root,relative),'utf8');if(sql.includes('\r\n'))throw new Error('CANONICAL_SQL_REQUIRES_LF: '+relative);return sql;};
  const db = new PGlite({ extensions: { pgcrypto, 'uuid-ossp': uuid_ossp } });
  const report = { packageVersion: JSON.parse(readFileSync(join(resolve(packageRoot), 'package.json'),'utf8')).version,
    prototypeOnly:true, productionContacted:false, authStubOnly:true, applied:0, failedFile:null };
  const digest=createHash('sha256');
  let file='supabase/ci/stub_auth.sql';
  try {
    await db.exec(`CREATE TABLE public.schema_migrations(id bigserial PRIMARY KEY,version text NOT NULL UNIQUE,
      name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    await db.exec(readSql(file));
    for (const name of readdirSync(join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
      file='supabase/migrations/'+name;
      const sql=readSql(file);
      digest.update(name).update('\0').update(sql).update('\0');
      await db.exec(sql);
      await db.query('INSERT INTO public.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
        [name.replace(/\.sql$/i,''),name,createHash('sha256').update(sql).digest('hex')]);
      report.applied++;
    }
    report.schemaReplayComplete=true;
    report.migrationSourceSha256=digest.digest('hex');
    report.installedExtensions=(await db.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
    return { db, report, root };
  } catch(error) {
    report.failedFile=file;report.sqlstate=error.code;report.error=String(error.message).slice(0,250);report.schemaReplayComplete=false;
    await db.close();
    error.probeReport=report;
    throw error;
  }
}
