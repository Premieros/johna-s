// Private backup primitives; no network, credentials, default key or auto activation.
import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { applicationSchemaFingerprint } from './schema-identity.mjs';
const magic=Buffer.from('JOHNAS-OWNED-BACKUP-1\n');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields=['version','branchId','storeSchema','protocolVersion','engineVersion','applicationSchema','keyId','createdAt','size','sha256'];
const maximum=512*1024*1024;
function keyBytes(key){if(!(key instanceof Uint8Array)||key.length!==32)throw Error('EXPLICIT_256_BIT_BACKUP_KEY_REQUIRED');return Buffer.from(key);}
function metadata(m){
  if(!m||Object.keys(m).sort().join(',')!==[...fields].sort().join(',')||m.version!==1||!uuid.test(m.branchId)||!uuid.test(m.keyId)||m.storeSchema!==1||m.protocolVersion!==1||!/^[a-f0-9]{64}$/.test(m.applicationSchema)||!/^\d+\.\d+\.\d+$/.test(m.engineVersion)||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||new Date(m.createdAt).toISOString()!==m.createdAt||!Number.isSafeInteger(m.size)||m.size<1||m.size>maximum||!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('INVALID_BACKUP_METADATA');
}
export async function sealBackup({snapshot,key,keyId,engineVersion}){
  const secret=keyBytes(key);
  if(!snapshot?.archive||typeof snapshot.archive.arrayBuffer!=='function')throw Error('OWNED_DATABASE_SNAPSHOT_REQUIRED');
  if(snapshot.archive.size>maximum)throw Error('BACKUP_TOO_LARGE');
  const plaintext=Buffer.from(await snapshot.archive.arrayBuffer());
  const meta={version:1,branchId:snapshot.branchId,storeSchema:snapshot.storeSchema,protocolVersion:snapshot.protocolVersion,engineVersion,applicationSchema:snapshot.applicationSchema,keyId,
    createdAt:new Date().toISOString(),size:plaintext.length,sha256:createHash('sha256').update(plaintext).digest('hex')};
  metadata(meta);
  const header=Buffer.from(JSON.stringify(meta));
  const headerSize=Buffer.alloc(4);headerSize.writeUInt32BE(header.length);
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(header);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return Buffer.concat([magic,headerSize,header,nonce,cipher.getAuthTag(),ciphertext]);
}
export function openBackup({backup,key,expectedBranchId,expectedEngineVersion,expectedApplicationSchema}){
  const secret=keyBytes(key);
  if(!uuid.test(expectedBranchId)||typeof expectedEngineVersion!=='string'||!/^[a-f0-9]{64}$/.test(expectedApplicationSchema))throw Error('RESTORE_TARGET_REQUIRED');
  if(!(backup instanceof Uint8Array))throw Error('INVALID_BACKUP_BYTES');
  const bytes=Buffer.from(backup);
  if(bytes.length>maximum+65536||bytes.length<magic.length+4+28||!bytes.subarray(0,magic.length).equals(magic))throw Error('INVALID_BACKUP_FORMAT');
  const headerSize=bytes.readUInt32BE(magic.length),start=magic.length+4,end=start+headerSize;
  if(headerSize<2||headerSize>16384||bytes.length<end+28)throw Error('INVALID_BACKUP_FORMAT');
  const header=bytes.subarray(start,end);let meta;
  try{meta=JSON.parse(header.toString('utf8'));}catch{throw Error('INVALID_BACKUP_METADATA');}
  metadata(meta);
  if(meta.branchId!==expectedBranchId)throw Error('FOREIGN_BRANCH_BACKUP');
  if(meta.engineVersion!==expectedEngineVersion)throw Error('BACKUP_ENGINE_INCOMPATIBLE');
  if(meta.applicationSchema!==expectedApplicationSchema)throw Error('BACKUP_APPLICATION_SCHEMA_INCOMPATIBLE');
  if(bytes.length-end-28!==meta.size)throw Error('BACKUP_LENGTH_MISMATCH');
  let plaintext;
  try{
    const decipher=createDecipheriv('aes-256-gcm',secret,bytes.subarray(end,end+12));
    decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(end+12,end+28));
    plaintext=Buffer.concat([decipher.update(bytes.subarray(end+28)),decipher.final()]);
  }catch{throw Error('BACKUP_AUTHENTICATION_FAILED');}
  if(createHash('sha256').update(plaintext).digest('hex')!==meta.sha256)throw Error('BACKUP_DIGEST_MISMATCH');
  return Object.freeze({...meta,archive:new Blob([plaintext])});
}
export async function restoreBackupToNewDirectory({directory,backup,key,expectedBranchId,expectedEngineVersion,expectedApplicationSchema,openDatabase}){
  // Authenticate before any filesystem mutation. Never overwrite an existing DB,
  // even an empty directory: unsent operations must not be lost by a restore.
  const decoded=openBackup({backup,key,expectedBranchId,expectedEngineVersion,expectedApplicationSchema});
  if(typeof directory!=='string'||!isAbsolute(directory)||/:\/\//.test(directory)||typeof openDatabase!=='function')throw Error('NEW_LOCAL_RESTORE_DIRECTORY_REQUIRED');
  await mkdir(directory,{recursive:false,mode:0o700});
  let db;
  try{
    db=await openDatabase({dataDir:directory,loadDataDir:decoded.archive});
    const rows=(await db.query('SELECT branch_id,schema_version FROM branch_hub_v1.identity')).rows;
    if(rows.length!==1||rows[0].branch_id!==expectedBranchId||rows[0].schema_version!==decoded.storeSchema)throw Error('RESTORED_DATABASE_IDENTITY_MISMATCH');
    if(await applicationSchemaFingerprint(db)!==expectedApplicationSchema)throw Error('RESTORED_APPLICATION_SCHEMA_MISMATCH');
    await db.syncToFs();return db;
  }catch(error){
    if(db)await db.close().catch(()=>{});
    // Leave a failed fresh candidate for diagnosis. No existing directory is deleted.
    throw error;
  }
}
