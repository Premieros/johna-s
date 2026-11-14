import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOperationStore } from '../runtime/operation-store.mjs';
import { createOperation } from '../prototype/operation-contract.mjs';
import { database,store,operation,context,id } from './durable-store-fixture.mjs';
const packageRoot=process.env.JOHNAS_TEST_PGLITE_PACKAGE_ROOT;
if(!packageRoot)throw Error('Set installed JOHNAS_TEST_PGLITE_PACKAGE_ROOT; no external database accepted');
const counts=async db=>(await db.query(`SELECT (SELECT count(*)::int FROM public.synthetic_ledger) AS ledger,
  (SELECT count(*)::int FROM branch_hub_v1.operations) AS inbox,
  (SELECT count(*)::int FROM branch_hub_v1.outbox) AS outbox`)).rows[0];
test('simultaneous retries commit one effect and retain frozen financial payload',async()=>{
  const db=await database(packageRoot);try{
    const local=await store(db),op=operation();
    const responses=await Promise.all(Array.from({length:8},()=>local.commit(context,op)));
    assert.equal(responses.filter(r=>!r.duplicate).length,1);
    assert.deepEqual(await counts(db),{ledger:1,inbox:1,outbox:1});
    assert.equal((await local.pending())[0].envelope.payload.total,'10.50');
    await assert.rejects(local.commit(context,operation(1,{payload:{total:'99.00'}})),/REUSED_WITH_DIFFERENT_CONTENT/);
    await assert.rejects(local.commit(context,operation(3)),/SEQUENCE_GAP_OR_REUSE/);
  }finally{await db.close();}
});
test('outbox failure rolls back business effect, inbox and device cursor; retry recovers',async()=>{
  const db=await database(packageRoot);try{
    const local=await store(db);await local.commit(context,operation());
    await db.exec(`CREATE FUNCTION public.fail_lab_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LAB_OUTBOX_FAILURE'; END $$;
      CREATE TRIGGER lab_outbox_failure BEFORE INSERT ON branch_hub_v1.outbox FOR EACH ROW EXECUTE FUNCTION public.fail_lab_outbox()`);
    await assert.rejects(local.commit(context,operation(2)),/LAB_OUTBOX_FAILURE/);
    assert.deepEqual(await counts(db),{ledger:1,inbox:1,outbox:1});
    assert.equal((await db.query('SELECT last_sequence::text AS n FROM branch_hub_v1.devices')).rows[0].n,'1');
    await db.exec('DROP TRIGGER lab_outbox_failure ON branch_hub_v1.outbox');
    await local.commit(context,operation(2));assert.deepEqual(await counts(db),{ledger:2,inbox:2,outbox:2});
  }finally{await db.close();}
});
test('authorization, branch enrollment and verified receipt fail closed; ACK never deletes records',async()=>{
  const db=await database(packageRoot);try{
    let allowed=false,receiptVerified=false;
    const local=await store(db,{authorize:async()=>allowed,verifyReceipt:async()=>receiptVerified});
    await assert.rejects(local.commit(context,operation()),/ACTION_FORBIDDEN/);allowed=true;
    const first=await local.commit(context,operation());allowed=false;
    await assert.rejects(local.commit(context,operation()),/ACTION_FORBIDDEN/);allowed=true;
    const other={...context,branchId:id(98)};
    await assert.rejects(local.commit(other,createOperation(other,{operationId:id(99),sequence:1,kind:'sale.commit',createdAt:'2026-11-14T00:00:00.000Z',payload:{total:'10.50'}})),/FOREIGN_BRANCH/);
    await assert.rejects(createOperationStore({db,branchId:id(98),handlers:{},authorize:async()=>true}),/BRANCH_OR_SCHEMA_MISMATCH/);
    const receipt={branchId:context.branchId,operationId:first.operationId,digest:first.digest,receiptId:id(50)};
    await assert.rejects(local.acknowledge(receipt),/UNVERIFIED_CLOUD_RECEIPT/);receiptVerified=true;
    await assert.rejects(local.acknowledge({...receipt,digest:'0'.repeat(64)}),/RECEIPT_OPERATION_MISMATCH/);
    assert.equal((await local.acknowledge(receipt)).duplicate,false);
    assert.equal((await local.acknowledge(receipt)).duplicate,true);
    await assert.rejects(local.acknowledge({...receipt,receiptId:id(51)}),/CLOUD_RECEIPT_CONFLICT/);
    assert.equal((await local.pending()).length,0);assert.deepEqual(await counts(db),{ledger:1,inbox:1,outbox:1});
    assert.equal((await local.commit(context,operation())).cloudState,'acknowledged');
  }finally{await db.close();}
});
test('flush failure returns no successful ACK; retry finds the committed effect once',async()=>{
  const db=await database(packageRoot);try{
    let fail=false;
    const facade={transaction:db.transaction.bind(db),query:db.query.bind(db),syncToFs:async()=>{
      if(fail){fail=false;throw Error('LAB_FLUSH_FAILURE');}return db.syncToFs();
    }};
    const local=await store(facade);fail=true;
    await assert.rejects(local.commit(context,operation()),/LAB_FLUSH_FAILURE/);
    assert.equal((await local.commit(context,operation())).duplicate,true);
    assert.deepEqual(await counts(db),{ledger:1,inbox:1,outbox:1});
  }finally{await db.close();}
});
function worker(dataDir,mode) {
  const child=fork(fileURLToPath(new URL('./durable-store-worker.mjs',import.meta.url)),[packageRoot,dataDir,mode],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
  const message=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('WORKER_TIMEOUT '+stderr));},30000);
    child.once('message',m=>{clearTimeout(timer);if(m.stage==='error')reject(Error(m.error+' '+stderr));else resolve(m);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('WORKER_EXIT '+code+' '+stderr));});
  });
  const ended=new Promise(resolve=>child.once('exit',resolve));
  return {child,message,ended};
}
test('process-kill recovery keeps committed inbox/outbox; uncommitted effect rolls back', {timeout:90000},async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'johnas-durable-'));const children=[];
  try{
    let w=worker(dataDir,'commit');children.push(w);assert.equal((await w.message).stage,'committed');w.child.kill('SIGKILL');await w.ended;
    w=worker(dataDir,'inspect');children.push(w);let result=await w.message;await w.ended;
    assert.equal(result.retry,true);assert.deepEqual(result.count,{n:1,total:'10.50'});assert.equal(result.pending,1);
    w=worker(dataDir,'uncommitted');children.push(w);assert.equal((await w.message).stage,'uncommitted');w.child.kill('SIGKILL');await w.ended;
    w=worker(dataDir,'inspect');children.push(w);result=await w.message;await w.ended;
    assert.equal(result.retry,true);assert.deepEqual(result.count,{n:1,total:'10.50'});assert.equal(result.pending,1);
  }finally{for(const w of children){if(w.child.exitCode===null&&!w.child.killed)w.child.kill('SIGKILL');}await Promise.all(children.map(w=>w.ended));await rm(dataDir,{recursive:true,force:true});}
});
