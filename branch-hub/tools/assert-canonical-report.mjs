// Fail closed if a fixture silently skips or returns without executing its tests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(report.success,true,'Canonical suite failed');
assert.equal(report.numTotalTests,17,'Expected all seventeen canonical cases');
assert.equal(report.numPassedTests,17,'Every canonical case must pass');
assert.equal(report.numPendingTests,0,'Skipped cases are not parity evidence');
assert.equal(report.numFailedTests,0);
for(const suite of report.testResults) {
  for(const test of suite.assertionResults) assert.equal(test.status,'passed',test.fullName);
}
console.log('PASS: all 17 canonical cases executed; no skipped cases. Auth and concurrency remain outside this fixture.');
