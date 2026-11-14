import { database,store,operation } from './durable-store-fixture.mjs';
const [packageRoot,dataDir,mode]=process.argv.slice(2);
try{
  const db=await database(packageRoot,dataDir);
  const options=mode==='uncommitted'?{handlers:{'sale.commit':async({tx,operation:op})=>{
    await tx.query('INSERT INTO public.synthetic_ledger(operation_id,amount) VALUES($1,$2::numeric)',[op.operationId,op.payload.total]);
    process.send({stage:'uncommitted'});
    await new Promise(()=>{});
  }}}:{};
  const local=await store(db,options);
  if(mode==='commit'){await local.commit({branchId:'10000000-0000-0000-0000-000000000001',deviceId:'10000000-0000-0000-0000-000000000002',userId:'10000000-0000-0000-0000-000000000003'},operation());process.send({stage:'committed'});setInterval(()=>{},1000);}
  else if(mode==='uncommitted'){await local.commit({branchId:'10000000-0000-0000-0000-000000000001',deviceId:'10000000-0000-0000-0000-000000000002',userId:'10000000-0000-0000-0000-000000000003'},operation(2));}
  else{
    const retry=await local.commit({branchId:'10000000-0000-0000-0000-000000000001',deviceId:'10000000-0000-0000-0000-000000000002',userId:'10000000-0000-0000-0000-000000000003'},operation());
    const count=(await db.query('SELECT count(*)::int AS n,sum(amount)::text AS total FROM public.synthetic_ledger')).rows[0];
    const pending=await local.pending();
    await db.close();process.send({stage:'inspected',retry:retry.duplicate,count,pending:pending.length});process.disconnect();
  }
}catch(error){process.send?.({stage:'error',error:String(error.message)});process.exitCode=1;process.disconnect?.();}
