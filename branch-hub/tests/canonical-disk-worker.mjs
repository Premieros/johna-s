// Disposable canonical-data crash worker. Never an Auth/server implementation.
import { readFile } from 'node:fs/promises';
import { openOwnedPglite } from '../experiments/open-owned-pglite.mjs';
import { createOperationStore } from '../runtime/operation-store.mjs';
import { makeCanonicalSplitHandler } from './canonical-split-handler.mjs';
const [packageRoot,dataDir,configPath,mode]=process.argv.slice(2);
try{
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const db=await openOwnedPglite(packageRoot,{dataDir});
  await db.exec("SET app.ci_subscription_bypass='on'");
  const hook=mode==='uncommitted'?async()=>{process.send({stage:'uncommitted'});await new Promise(()=>{});}:undefined;
  const store=await createOperationStore({db,branchId:config.context.branchId,authorize:async()=>true,handlers:{'sale.commit':makeCanonicalSplitHandler(config,hook)}});
  const response=await store.commit(config.context,mode==='uncommitted'||mode==='finish-third'?config.third:config.second);
  if(mode==='commit'){
    process.send({stage:'committed',saleId:response.result.sale_id});setInterval(()=>{},1000);
  }else if(mode!=='uncommitted'){
    const rows=(await db.query(`SELECT count(*)::int AS sales,
      (SELECT count(*)::int FROM public.sale_payments WHERE sale_id IN (SELECT id FROM public.sales WHERE invoice_number LIKE 'LOCAL-ATOMIC-%')) AS tenders,
      (SELECT count(*)::int FROM branch_hub_v1.outbox WHERE acked_at IS NULL) AS pending,
      (SELECT sum(quantity)::text FROM public.inventory_unit_batches WHERE unit_id=$1) AS quantity,
      (SELECT count(*)::int FROM public.schema_migrations) AS migrations
      FROM public.sales WHERE invoice_number LIKE 'LOCAL-ATOMIC-%'`,[config.unitId])).rows[0];
    await db.close();process.send({stage:'inspected',duplicate:response.duplicate,saleId:response.result.sale_id,rows});process.disconnect();
  }
}catch(error){process.send?.({stage:'error',error:String(error.message)});process.exitCode=1;process.disconnect?.();}
