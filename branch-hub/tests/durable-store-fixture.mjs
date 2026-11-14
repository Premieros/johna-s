// Disposable fixtures only: synthetic ledger, no production POS/auth implementation.
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOperationStore } from '../runtime/operation-store.mjs';
import { createOperation } from '../prototype/operation-contract.mjs';
export const id=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const context=Object.freeze({branchId:id(1),deviceId:id(2),userId:id(3)});
export const operation=(sequence=1,extra={})=>createOperation(context,{operationId:id(10+sequence),sequence,kind:'sale.commit',createdAt:'2026-11-14T00:00:00.000Z',payload:{total:'10.50'},...extra});
export async function database(packageRoot,dataDir) {
  if(!packageRoot||/:\/\//.test(packageRoot))throw Error('Installed package directory required, never a DB URL');
  const {PGlite}=await import(pathToFileURL(join(resolve(packageRoot),'dist/index.js')).href);
  const db=new PGlite({...(dataDir?{dataDir}:{}),relaxedDurability:false});
  await db.exec('CREATE TABLE IF NOT EXISTS public.synthetic_ledger(operation_id uuid PRIMARY KEY,amount numeric(12,2) NOT NULL)');
  return db;
}
export function store(db,options={}) {
  return createOperationStore({db,branchId:context.branchId,authorize:async()=>true,
    handlers:{'sale.commit':async({tx,operation:op})=>{
      await tx.query('INSERT INTO public.synthetic_ledger(operation_id,amount) VALUES($1,$2::numeric)',[op.operationId,op.payload.total]);
      return {success:true,sale_id:op.operationId,total:op.payload.total};
    }},...options});
}
