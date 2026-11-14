// A1 private single-owner storage core. Not imported by POS, API or print agents.
// No network/.env/connection strings. Caller must exclusively own this database.
import { createOperation, verifyOperation } from '../prototype/operation-contract.mjs';
import { applicationSchemaFingerprint } from './schema-identity.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function createOperationStore({db,branchId,handlers,authorize,verifyReceipt}) {
  if(!uuid.test(branchId)||typeof authorize!=='function'||!db?.transaction||!db?.syncToFs)throw Error('STORE_CONFIGURATION_REQUIRED');
  const registered=Object.freeze({...handlers});
  // One store owner serializes writes. This is not a multi-process lock.
  let tail=Promise.resolve();
  const serialize=fn=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;};
  await db.transaction(async tx=>{
    await tx.exec(`CREATE SCHEMA IF NOT EXISTS branch_hub_v1;
      REVOKE ALL ON SCHEMA branch_hub_v1 FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS branch_hub_v1.identity (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),branch_id uuid NOT NULL,schema_version integer NOT NULL CHECK(schema_version=1));
      CREATE TABLE IF NOT EXISTS branch_hub_v1.devices (
        device_id uuid PRIMARY KEY,last_sequence bigint NOT NULL CHECK(last_sequence>=0));
      CREATE TABLE IF NOT EXISTS branch_hub_v1.operations (
        operation_id uuid PRIMARY KEY,device_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),
        envelope jsonb NOT NULL,digest text NOT NULL,result jsonb NOT NULL,
        committed_at timestamptz NOT NULL DEFAULT now(),UNIQUE(device_id,sequence));
      CREATE TABLE IF NOT EXISTS branch_hub_v1.outbox (
        operation_id uuid PRIMARY KEY REFERENCES branch_hub_v1.operations(operation_id),
        acked_at timestamptz,receipt jsonb,
        CHECK((acked_at IS NULL AND receipt IS NULL) OR (acked_at IS NOT NULL AND receipt IS NOT NULL)));
      ALTER TABLE branch_hub_v1.identity ENABLE ROW LEVEL SECURITY;
      ALTER TABLE branch_hub_v1.devices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE branch_hub_v1.operations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE branch_hub_v1.outbox ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON ALL TABLES IN SCHEMA branch_hub_v1 FROM PUBLIC;`);
    await tx.query('INSERT INTO branch_hub_v1.identity(singleton,branch_id,schema_version) VALUES(true,$1,1) ON CONFLICT DO NOTHING',[branchId]);
    const identity=(await tx.query('SELECT branch_id,schema_version FROM branch_hub_v1.identity')).rows;
    if(identity.length!==1||identity[0].branch_id!==branchId||identity[0].schema_version!==1)throw Error('STORE_BRANCH_OR_SCHEMA_MISMATCH');
  });
  await db.syncToFs();
  return Object.freeze({
    async commit(context,operation) {
      verifyOperation(context,operation);
      if(context.branchId!==branchId)throw Error('FOREIGN_BRANCH');
      const trustedContext=Object.freeze({...context});
      const {operationId,sequence,kind,createdAt,payload}=operation;
      const snapshot=createOperation(trustedContext,{operationId,sequence,kind,createdAt,payload});
      // Snapshot before yielding, so UI/caller mutation cannot alter an accepted command.
      return serialize(async()=>{
        if(await authorize(trustedContext,snapshot)!==true)throw Error('ACTION_FORBIDDEN');
        const response=await db.transaction(async tx=>{
          const existing=(await tx.query(`SELECT o.digest,o.result,b.acked_at FROM branch_hub_v1.operations o
            JOIN branch_hub_v1.outbox b USING(operation_id) WHERE o.operation_id=$1`,[snapshot.operationId])).rows[0];
          if(existing){
            if(existing.digest!==snapshot.digest)throw Error('OPERATION_ID_REUSED_WITH_DIFFERENT_CONTENT');
            return {duplicate:true,operationId:snapshot.operationId,digest:snapshot.digest,result:existing.result,cloudState:existing.acked_at?'acknowledged':'pending'};
          }
          const last=(await tx.query('SELECT last_sequence::text AS n FROM branch_hub_v1.devices WHERE device_id=$1',[snapshot.deviceId])).rows[0];
          if(snapshot.sequence!==Number(last?.n||0)+1)throw Error('DEVICE_SEQUENCE_GAP_OR_REUSE');
          const handler=registered[snapshot.kind];
          if(typeof handler!=='function')throw Error('BUSINESS_HANDLER_NOT_REGISTERED');
          // Handler is registered server code, never SQL or a function from request JSON.
          // It MUST use this tx, not another DB/connection or an external side effect.
          const result=await handler({tx,context:trustedContext,operation:snapshot});
          if(!result||typeof result!=='object'||Array.isArray(result)||result.success!==true)throw Error('BUSINESS_ACTION_REJECTED');
          const encoded=JSON.stringify(result);
          if(Buffer.byteLength(encoded)>65536)throw Error('BUSINESS_RESULT_TOO_LARGE');
          await tx.query(`INSERT INTO branch_hub_v1.operations(operation_id,device_id,sequence,envelope,digest,result)
            VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb)`,[snapshot.operationId,snapshot.deviceId,snapshot.sequence,JSON.stringify(snapshot),snapshot.digest,encoded]);
          await tx.query('INSERT INTO branch_hub_v1.outbox(operation_id) VALUES($1)',[snapshot.operationId]);
          await tx.query(`INSERT INTO branch_hub_v1.devices(device_id,last_sequence) VALUES($1,$2)
            ON CONFLICT(device_id) DO UPDATE SET last_sequence=EXCLUDED.last_sequence`,[snapshot.deviceId,snapshot.sequence]);
          return {duplicate:false,operationId:snapshot.operationId,digest:snapshot.digest,result:JSON.parse(encoded),cloudState:'pending'};
        });
        // A flush failure after SQL commit is ambiguous: return no ACK. A retry
        // finds the committed inbox result rather than executing the handler again.
        await db.syncToFs();
        return response;
      });
    },
    // Private backup seam: queue barrier excludes this owner's business writes.
    // Caller must exclusively own db; never expose the raw archive to a browser.
    async snapshot() {
      return serialize(async()=>{
        if(typeof db.dumpDataDir!=='function')throw Error('BACKUP_NOT_SUPPORTED');
        await db.syncToFs();
        const applicationSchema=await applicationSchemaFingerprint(db);
        const archive=await db.dumpDataDir('gzip');
        return Object.freeze({branchId,storeSchema:1,protocolVersion:1,applicationSchema,archive});
      });
    },
    // Private worker API, not a public/HTTP endpoint. The store holds one branch only.
    async pending(limit=25) {
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_BATCH_LIMIT');
      return serialize(async()=> (await db.query(`SELECT o.envelope,o.digest,o.result FROM branch_hub_v1.operations o
        JOIN branch_hub_v1.outbox b USING(operation_id) WHERE b.acked_at IS NULL
        ORDER BY o.committed_at,o.device_id,o.sequence LIMIT $1`,[limit])).rows);
    },
    async acknowledge(receipt) {
      const snapshot=JSON.parse(JSON.stringify(receipt));
      if(!snapshot||Object.keys(snapshot).sort().join(',')!=='branchId,digest,operationId,receiptId'||snapshot.branchId!==branchId||!uuid.test(snapshot.operationId)||!uuid.test(snapshot.receiptId)||!/^[a-f0-9]{64}$/.test(snapshot.digest))throw Error('INVALID_CLOUD_RECEIPT');
      return serialize(async()=>{
        if(typeof verifyReceipt!=='function'||await verifyReceipt(Object.freeze(snapshot))!==true)throw Error('UNVERIFIED_CLOUD_RECEIPT');
        const result=await db.transaction(async tx=>{
          const record=(await tx.query(`SELECT o.digest,b.receipt FROM branch_hub_v1.operations o
            JOIN branch_hub_v1.outbox b USING(operation_id) WHERE o.operation_id=$1`,[snapshot.operationId])).rows[0];
          if(!record||record.digest!==snapshot.digest)throw Error('RECEIPT_OPERATION_MISMATCH');
          if(record.receipt){if(record.receipt.receiptId!==snapshot.receiptId)throw Error('CLOUD_RECEIPT_CONFLICT');return {acknowledged:true,duplicate:true};}
          await tx.query('UPDATE branch_hub_v1.outbox SET acked_at=now(),receipt=$2::jsonb WHERE operation_id=$1',[snapshot.operationId,JSON.stringify(snapshot)]);
          return {acknowledged:true,duplicate:false};
        });
        await db.syncToFs();return result;
      });
    }
  });
}
