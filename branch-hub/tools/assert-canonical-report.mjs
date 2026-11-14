// Fail closed if a fixture silently skips or returns without executing its tests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
const expected=process.argv[3]===undefined?17:Number(process.argv[3]);
assert.ok(Number.isSafeInteger(expected)&&expected>0&&expected<=100000,'Invalid expected case count');
assert.equal(report.success,true,'Canonical suite failed');
assert.equal(report.numTotalTests,expected,'Expected all canonical cases');
assert.equal(report.numPassedTests,expected,'Every canonical case must pass');
assert.equal(report.numPendingTests,0,'Skipped cases are not parity evidence');
assert.equal(report.numFailedTests,0);
for(const suite of report.testResults) {
  for(const test of suite.assertionResults) assert.equal(test.status,'passed',test.fullName);
}
console.log(`PASS: all ${expected} canonical cases executed; no skipped cases. Auth and concurrency remain outside this fixture.`);
