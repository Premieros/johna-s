// Replaces only the integration test connection helper in the explicit lab config.
// Never imports pg, reads .env, connects a socket or accepts a remote URL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanonicalMemoryDatabase } from './canonical-memory-db.mjs';
const token='pglite-synthetic-owned-only';
let active=false;
export function getDbUrl() { return token; }
export function openDb(value) {
  if(value!==token) throw new Error('External database input is forbidden');
  let db;
  return {
    async connect() {
      if(active) throw new Error('One owned client only: this adapter cannot prove concurrent-session behavior');
      active=true;
      try {
        const lab=await createCanonicalMemoryDatabase(process.env.JOHNAS_TEST_PGLITE_PACKAGE_ROOT);
        db=lab.db;
        for(const name of ['disable_subscription_guard.sql','seed_raw_material_branch.sql','permission_first_role_fixture.sql']) {
          await db.exec(readFileSync(join(lab.root,'supabase/ci',name),'utf8'));
        }
        // ALTER DATABASE affects future native connections; set the same CI-only
        // flag explicitly on this single already-open in-memory test session.
        await db.exec("SET app.ci_subscription_bypass='on'");
      } catch(error) { if(db) await db.close(); active=false;throw error; }
    },
    async query(sql,params=[]) {
      if(!db) throw new Error('Test database is not connected');
      if(typeof sql!=='string') throw new Error('Only canonical string queries are supported');
      const result=params.length ? await db.query(sql,params) : (await db.exec(sql)).at(-1);
      return {...result,rows:result?.rows||[],rowCount:result?.affectedRows??result?.rows?.length??0};
    },
    async end() { if(db) {await db.close();db=undefined;} active=false; }
  };
}
