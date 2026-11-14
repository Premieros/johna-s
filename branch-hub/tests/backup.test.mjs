import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealBackup,openBackup,restoreBackupToNewDirectory } from '../runtime/backup.mjs';
const branchId='20000000-0000-0000-0000-000000000001',keyId='20000000-0000-0000-0000-000000000002';
const snapshot=()=>({branchId,storeSchema:1,protocolVersion:1,applicationSchema:'a'.repeat(64),archive:new Blob(['synthetic archive with pending operation'])});
test('encrypted backup rejects foreign branch/engine, missing keys, changed header and ciphertext',async()=>{
  const key=randomBytes(32),backup=await sealBackup({snapshot:snapshot(),key,keyId,engineVersion:'0.5.16'});
  const args={backup,key,expectedBranchId:branchId,expectedEngineVersion:'0.5.16',expectedApplicationSchema:'a'.repeat(64)};
  assert.equal(await openBackup(args).archive.text(),'synthetic archive with pending operation');
  assert.equal(backup.includes(Buffer.from('synthetic archive')),false);
  assert.throws(()=>openBackup({...args,key:undefined}),/EXPLICIT_256_BIT/);
  assert.throws(()=>openBackup({...args,key:randomBytes(32)}),/AUTHENTICATION_FAILED/);
  assert.throws(()=>openBackup({...args,expectedBranchId:keyId}),/FOREIGN_BRANCH/);
  assert.throws(()=>openBackup({...args,expectedEngineVersion:'0.6.0'}),/ENGINE_INCOMPATIBLE/);
  assert.throws(()=>openBackup({...args,expectedApplicationSchema:'b'.repeat(64)}),/APPLICATION_SCHEMA_INCOMPATIBLE/);
  const damaged=Buffer.from(backup);damaged[damaged.length-1]^=1;
  assert.throws(()=>openBackup({...args,backup:damaged}),/AUTHENTICATION_FAILED/);
  const changed=Buffer.from(backup),at=changed.indexOf(Buffer.from(keyId));changed[at+keyId.length-1]='3'.charCodeAt(0);
  assert.throws(()=>openBackup({...args,backup:changed}),/AUTHENTICATION_FAILED/);
  assert.throws(()=>openBackup({...args,backup:backup.subarray(0,backup.length-1)}),/LENGTH_MISMATCH/);
});
test('restore authenticates first and refuses an existing directory without calling loader',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'johnas-backup-'));
  const key=randomBytes(32),backup=await sealBackup({snapshot:snapshot(),key,keyId,engineVersion:'0.5.16'});let called=false;
  try{
    await assert.rejects(restoreBackupToNewDirectory({directory,backup,key,expectedBranchId:branchId,expectedEngineVersion:'0.5.16',expectedApplicationSchema:'a'.repeat(64),openDatabase:async()=>{called=true;}}),/EEXIST/);
    assert.equal(called,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
