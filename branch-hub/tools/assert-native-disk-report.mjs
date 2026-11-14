import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const key of ['success','encryptedRestore','existingDirectoryRejected','foreignBranchRejected','pendingOutboxPreserved','retrySaleIdStable','uncommittedSaleRolledBack','retryAfterRollback'])assert.equal(report[key],true,key);
assert.equal(report.platform,process.platform);assert.equal(report.testsExecuted,1);assert.equal(report.migrations,558);
console.log(`PASS: native ${process.platform} executed encrypted restore and canonical disk crash/retry assertions.`);
