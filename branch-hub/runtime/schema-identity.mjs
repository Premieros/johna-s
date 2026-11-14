import { createHash } from 'node:crypto';
// Canonical migration-ledger fingerprint, not a live DDL/advisor audit.
export async function applicationSchemaFingerprint(db){
  const rows=(await db.query('SELECT version,name,checksum FROM public.schema_migrations ORDER BY version,name')).rows;
  if(!rows.length||rows.some(r=>typeof r.version!=='string'||typeof r.name!=='string'||!/^[a-f0-9]{64}$/.test(r.checksum)))throw Error('CANONICAL_MIGRATION_LEDGER_REQUIRED');
  return createHash('sha256').update(JSON.stringify(rows.map(r=>[r.version,r.name,r.checksum]))).digest('hex');
}
