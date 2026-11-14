import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRelease,verifyRelease } from '../update-lab/release-contract.mjs';
import { startLab } from '../update-lab/server.mjs';
const payload={title:'Synthetic release',newScreen:true};
test('signed presentation rejects tampering, foreign signer, rollback and incompatible schema',()=>{
  const keys=generateKeyPairSync('ed25519'),foreign=generateKeyPairSync('ed25519');
  const r=makeRelease(2,payload,keys.privateKey);
  const context={publicKey:keys.publicKey,currentSequence:1,schemaVersion:1};
  assert.deepEqual(verifyRelease(r.manifest,r.bytes,context),{sequence:2,payload});
  assert.throws(()=>verifyRelease(r.manifest,Buffer.from('{}'),context),/PAYLOAD_INVALID/);
  assert.throws(()=>verifyRelease({...r.manifest,sequence:3},r.bytes,context),/SIGNATURE_INVALID/);
  assert.throws(()=>verifyRelease(r.manifest,r.bytes,{...context,publicKey:foreign.publicKey}),/SIGNATURE_INVALID/);
  assert.throws(()=>verifyRelease(r.manifest,r.bytes,{...context,currentSequence:2}),/RELEASE_NOT_NEWER/);
  assert.throws(()=>verifyRelease(r.manifest,r.bytes,{...context,schemaVersion:2}),/SCHEMA_INCOMPATIBLE/);
  assert.throws(()=>verifyRelease({...r.manifest,extra:true},r.bytes,context),/MANIFEST_FIELDS/);
});
test('browser API stages updates during payment, survives simulated outage and normal restart',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'johnas-update-'));
  let lab;
  try{
    lab=await startLab({dataDir,port:0,feedPort:0,pollMs:1000000});
    const post=async(path,data)=>{const response=await fetch(`http://127.0.0.1:${lab.port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:`http://127.0.0.1:${lab.port}`},body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
    await post('draft',{text:'Synthetic table 5',revision:1});
    await post('draft',{text:'stale draft',revision:1});assert.equal(lab.view().draft,'Synthetic table 5');
    await post('feed',{online:false});await post('publish-demo',{});await lab.poll();
    assert.equal(lab.view().sequence,1);assert.equal(lab.view().draft,'Synthetic table 5');
    await post('feed',{online:true});await lab.poll();assert.equal(lab.view().sequence,2);
    const payment=post('payment-demo',{});
    while(!lab.view().busy)await new Promise(r=>setTimeout(r,10));
    await post('publish-demo',{});await lab.poll();assert.equal(lab.view().sequence,2);assert.equal(lab.view().stagedSequence,3);
    await payment;await lab.poll();assert.equal(lab.view().sequence,3);assert.equal(lab.view().payments,1);
    await post('publish-demo',{corrupt:true});await lab.poll();assert.equal(lab.view().sequence,3);assert.equal(lab.view().lastError,'PAYLOAD_INVALID');
    const blocked=await fetch(`http://127.0.0.1:${lab.port}/api/state`,{headers:{Origin:'https://untrusted.invalid'}});assert.equal(blocked.status,403);
    await lab.close();lab=await startLab({dataDir,port:0,feedPort:0,pollMs:1000000});
    assert.equal(lab.view().sequence,3);assert.equal(lab.view().draft,'Synthetic table 5');assert.equal(lab.view().payments,1);
  }finally{if(lab)await lab.close();await rm(dataDir,{recursive:true,force:true});}
});
