// Shared scenario for native Node (Windows/Linux) and optional Vitest wrapper.
// CI-only canonical Auth/subscription fixtures, never real credentials or cloud DB.
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,rm,writeFile,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareCanonicalAtomicFixture } from './canonical-business-fixture.ts';
import { openOwnedPglite } from '../experiments/open-owned-pglite.mjs';
import { sealBackup,restoreBackupToNewDirectory } from '../runtime/backup.mjs';
const packageRoot=process.env.JOHNAS_TEST_PGLITE_PACKAGE_ROOT;
function worker(dataDir,configPath,mode){
  if(!packageRoot)throw Error('Owned package directory required');
  const child=fork(fileURLToPath(new URL('./canonical-disk-worker.mjs',import.meta.url)),[packageRoot,dataDir,configPath,mode],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let stderr='',seen=false;child.stderr.on('data',c=>{stderr=(stderr+c).slice(-3000);});
  const ended=new Promise(resolve=>child.once('exit',resolve));
  const message=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CANONICAL_WORKER_TIMEOUT '+stderr));},60000);
    child.once('message',m=>{seen=true;clearTimeout(timer);if(m.stage==='error')reject(Error(m.error+' '+stderr));else resolve(m);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);if(!seen)reject(Error(`CANONICAL_WORKER_EXIT ${code}/${signal} ${stderr}`));});
  });
  return {child,message,ended};
}
export async function runCanonicalDiskScenario(){
  const temp=await mkdtemp(join(tmpdir(),'johnas-canonical-disk-'));
  const fixture=await prepareCanonicalAtomicFixture();const children=[];let restored;
  try{
    const first=fixture.op(1),second=fixture.op(2),third=fixture.op(3);
    await fixture.local.commit(fixture.context,first);
    const key=randomBytes(32),snapshot=await fixture.local.snapshot();
    const backup=await sealBackup({snapshot,key,keyId:randomUUID(),engineVersion:fixture.lab.report.packageVersion});
    await writeFile(join(temp,'backup.bin'),backup,{mode:0o600});
    const target=join(temp,'restored'),foreign=join(temp,'foreign');
    const restoreArgs={backup,key,expectedBranchId:fixture.context.branchId,expectedEngineVersion:fixture.lab.report.packageVersion,expectedApplicationSchema:snapshot.applicationSchema,
      openDatabase:options=>openOwnedPglite(packageRoot,options)};
    await assert.rejects(restoreBackupToNewDirectory({...restoreArgs,directory:foreign,expectedBranchId:randomUUID()}),/FOREIGN_BRANCH_BACKUP/);
    await assert.rejects(access(foreign));
    restored=await restoreBackupToNewDirectory({...restoreArgs,directory:target});
    const initial=(await restored.query('SELECT count(*)::int AS pending FROM branch_hub_v1.outbox WHERE acked_at IS NULL')).rows[0];
    assert.equal(initial.pending,1);
    await assert.rejects(restoreBackupToNewDirectory({...restoreArgs,directory:target}),/EEXIST/);
    await restored.close();restored=undefined;
    await fixture.db.close(); // Fence source before starting the recovered writer.
    const configPath=join(temp,'synthetic-context.json');
    await writeFile(configPath,JSON.stringify({context:fixture.context,warehouseId:fixture.ids.whA,shiftId:fixture.ids.shiftA,unitId:fixture.unitId,second,third}),{mode:0o600});
    let w=worker(target,configPath,'commit');children.push(w);const committed=await w.message;
    assert.equal(committed.stage,'committed');w.child.kill('SIGKILL');await w.ended;
    w=worker(target,configPath,'inspect');children.push(w);let result=await w.message;await w.ended;
    assert.equal(result.duplicate,true);assert.equal(result.saleId,committed.saleId);
    assert.deepEqual(result.rows,{sales:2,tenders:4,pending:2,quantity:'8.0000',migrations:558});
    w=worker(target,configPath,'uncommitted');children.push(w);assert.equal((await w.message).stage,'uncommitted');w.child.kill('SIGKILL');await w.ended;
    w=worker(target,configPath,'inspect');children.push(w);result=await w.message;await w.ended;
    assert.deepEqual(result.rows,{sales:2,tenders:4,pending:2,quantity:'8.0000',migrations:558});
    w=worker(target,configPath,'finish-third');children.push(w);result=await w.message;await w.ended;
    assert.equal(result.duplicate,false);assert.deepEqual(result.rows,{sales:3,tenders:6,pending:3,quantity:'7.0000',migrations:558});
    return {success:true,platform:process.platform,testsExecuted:1,migrations:558,encryptedRestore:true,existingDirectoryRejected:true,
      foreignBranchRejected:true,pendingOutboxPreserved:true,retrySaleIdStable:true,uncommittedSaleRolledBack:true,retryAfterRollback:true};
  }finally{
    for(const w of children)if(w.child.exitCode===null&&!w.child.killed)w.child.kill('SIGKILL');
    await Promise.all(children.map(w=>w.ended));if(restored)await restored.close().catch(()=>{});
    await fixture.db.close().catch(()=>{});await rm(temp,{recursive:true,force:true});
  }
}
