// Lab-only presentation release contract. Does not execute downloaded code or SQL.
import { createHash, sign, verify } from 'node:crypto';
const fields=['sequence','releaseId','schemaVersion','sha256','size'];
export function envelope(meta) {
  if(!meta || Object.keys(meta).sort().join(',')!==[...fields].sort().join(',')) throw new Error('MANIFEST_FIELDS');
  if(!Number.isSafeInteger(meta.sequence)||meta.sequence<1||!Number.isSafeInteger(meta.schemaVersion)||meta.schemaVersion<1||
    !/^lab-[1-9][0-9]*$/.test(meta.releaseId)||!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isSafeInteger(meta.size)||meta.size<1||meta.size>16384) throw new Error('MANIFEST_INVALID');
  return Buffer.from(JSON.stringify(Object.fromEntries(fields.map(k=>[k,meta[k]]))));
}
export function makeRelease(sequence,payload,privateKey) {
  const bytes=Buffer.from(JSON.stringify(payload));
  const meta={sequence,releaseId:`lab-${sequence}`,schemaVersion:1,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  return {manifest:{...meta,signature:sign(null,envelope(meta),privateKey).toString('base64')},bytes};
}
export function verifyRelease(manifest,bytes,{publicKey,currentSequence,schemaVersion}) {
  if(!manifest||Object.keys(manifest).sort().join(',')!==[...fields,'signature'].sort().join(',')) throw new Error('MANIFEST_FIELDS');
  const {signature,...meta}=manifest;
  if(typeof signature!=='string'||signature.length>256||!verify(null,envelope(meta),publicKey,Buffer.from(signature,'base64'))) throw new Error('SIGNATURE_INVALID');
  if(meta.sequence<=currentSequence) throw new Error('RELEASE_NOT_NEWER');
  if(meta.schemaVersion!==schemaVersion) throw new Error('SCHEMA_INCOMPATIBLE');
  if(bytes.length!==meta.size||createHash('sha256').update(bytes).digest('hex')!==meta.sha256) throw new Error('PAYLOAD_INVALID');
  const payload=JSON.parse(bytes.toString('utf8'));
  if(Object.keys(payload).sort().join(',')!=='newScreen,title'||typeof payload.title!=='string'||payload.title.length>100||typeof payload.newScreen!=='boolean') throw new Error('PRESENTATION_INVALID');
  return {sequence:meta.sequence,payload};
}
