import { it,expect } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,rm,writeFile,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareCanonicalAtomicFixture } from './canonical-business-fixture';
import { openOwnedPglite } from '../experiments/open-owned-pglite.mjs';
import { sealBackup,restoreBackupToNewDirectory } from '../runtime/backup.mjs';
const packageRoot=process.env.JOHNAS_TEST_PGLITE_PACKAGE_ROOT;
function worker(dataDir:string,configPath:string,mode:string){
  if(!packageRoot)throw Error('Owned package directory required');
  const child=fork(fileURLToPath(new URL('./canonical-disk-worker.mjs',import.meta.url)),[packageRoot,dataDir,configPath,mode],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let stderr='',seen=false;child.stderr!.on('data',c=>{stderr=(stderr+c).slice(-3000);});
  const ended=new Promise(resolve=>child.once('exit',resolve));
  const message=new Promise<{stage:string;duplicate?:boolean;saleId?:string;rows?:{sales:number;tenders:number;pending:number;quantity:string;migrations:number}}>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CANONICAL_WORKER_TIMEOUT '+stderr));},60000);
    child.once('message',(m:{stage:string;error?:string})=>{seen=true;clearTimeout(timer);if(m.stage==='error')reject(Error(m.error+' '+stderr));else resolve(m);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);if(!seen)reject(Error(`CANONICAL_WORKER_EXIT ${code}/${signal} ${stderr}`));});
  });
  return {child,message,ended};
}
it('restores encrypted canonical backup into a fresh disk DB and recovers split sales/outbox across process kills',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'johnas-canonical-disk-'));
  const fixture=await prepareCanonicalAtomicFixture();const children:ReturnType<typeof worker>[]=[];
  let restored:Awaited<ReturnType<typeof openOwnedPglite>>|undefined;
  try{
    const first=fixture.op(1),second=fixture.op(2),third=fixture.op(3);
    await fixture.local.commit(fixture.context,first);
    const key=randomBytes(32),snapshot=await fixture.local.snapshot();
    const backup=await sealBackup({snapshot,key,keyId:randomUUID(),engineVersion:fixture.lab.report.packageVersion});
    // Only the encrypted backup is retained as a fixture file; key stays in memory.
    await writeFile(join(temp,'backup.bin'),backup,{mode:0o600});
    const target=join(temp,'restored'),foreign=join(temp,'foreign');
    const restoreArgs={backup,key,expectedBranchId:fixture.context.branchId,expectedEngineVersion:fixture.lab.report.packageVersion,expectedApplicationSchema:snapshot.applicationSchema,
      openDatabase:(options:{dataDir:string;loadDataDir:Blob})=>openOwnedPglite(packageRoot,options)};
    await expect(restoreBackupToNewDirectory({...restoreArgs,directory:foreign,expectedBranchId:randomUUID()})).rejects.toThrow('FOREIGN_BRANCH_BACKUP');
    await expect(access(foreign)).rejects.toThrow();
    restored=await restoreBackupToNewDirectory({...restoreArgs,directory:target});
    const initial=(await restored.query(`SELECT count(*)::int AS pending FROM branch_hub_v1.outbox WHERE acked_at IS NULL`)).rows[0];
    expect(initial.pending).toBe(1);
    await expect(restoreBackupToNewDirectory({...restoreArgs,directory:target})).rejects.toThrow('EEXIST');
    await restored.close();restored=undefined;
    await fixture.db.close(); // Stop source before the recovered writer starts.
    const configPath=join(temp,'synthetic-context.json');
    await writeFile(configPath,JSON.stringify({context:fixture.context,warehouseId:fixture.ids.whA,shiftId:fixture.ids.shiftA,unitId:fixture.unitId,second,third}),{mode:0o600});
    let w=worker(target,configPath,'commit');children.push(w);const committed=await w.message;
    expect(committed.stage).toBe('committed');w.child.kill('SIGKILL');await w.ended;
    w=worker(target,configPath,'inspect');children.push(w);let result=await w.message;await w.ended;
    expect(result.duplicate).toBe(true);expect(result.saleId).toBe(committed.saleId);
    expect(result.rows).toEqual({sales:2,tenders:4,pending:2,quantity:'8.0000',migrations:558});
    w=worker(target,configPath,'uncommitted');children.push(w);expect((await w.message).stage).toBe('uncommitted');w.child.kill('SIGKILL');await w.ended;
    w=worker(target,configPath,'inspect');children.push(w);result=await w.message;await w.ended;
    expect(result.rows).toEqual({sales:2,tenders:4,pending:2,quantity:'8.0000',migrations:558});
    w=worker(target,configPath,'finish-third');children.push(w);result=await w.message;await w.ended;
    expect(result.duplicate).toBe(false);expect(result.rows).toEqual({sales:3,tenders:6,pending:3,quantity:'7.0000',migrations:558});
  }finally{
    for(const w of children)if(w.child.exitCode===null&&!w.child.killed)w.child.kill('SIGKILL');
    await Promise.all(children.map(w=>w.ended));if(restored)await restored.close().catch(()=>{});
    await fixture.db.close().catch(()=>{});await rm(temp,{recursive:true,force:true});
  }
},180000);
