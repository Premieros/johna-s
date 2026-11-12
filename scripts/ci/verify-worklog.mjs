import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The same fail-fast worklog invariants, without starting Vitest/React/jsdom.
const plan = readFileSync('docs/CURRENT_WORK_PLAN.md', 'utf8');
const path = plan.match(/Mandatory active work log:\s*`([^`]+)`/i)?.[1];
assert.match(path || '', /^docs\/[A-Z0-9_-]+\.md$/i);
const log = readFileSync(path, 'utf8');
for (const heading of ['Work status', 'Guardrails', 'Baseline', 'Root-cause ledger', 'Change ledger', 'Verification ledger', 'Production gate', 'Next action', 'Mandatory update protocol']) assert.ok(log.includes(`## ${heading}`));
assert.ok(log.includes('Repository: `Premieros/johna-s`'));
assert.ok(log.includes('Production Supabase: `azzdesuowpdcoflmyezn`'));
assert.match(log, /^Branch:\s*`[^`]+`/m);
assert.match(log, /^Current PR:\s*`?#?\d+`?/m);
assert.match(log, /^Last updated:\s*.+$/m);
assert.match(log, /^State: \*\*(BLOCKED|READY|DEPLOYED)\*\*/m);
const declaredPr = log.match(/^Current PR:\s*`?#?(\d+)`?/m)?.[1];
const ciPr = process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\/merge$/)?.[1];
if (process.env.GITHUB_HEAD_REF && ciPr && declaredPr === ciPr) assert.equal(log.match(/^Branch:\s*`([^`]+)`/m)?.[1], process.env.GITHUB_HEAD_REF);
for (const text of ['السجل هو المرجع الإجباري للعمل', 'CI يجب أن يفشل', 'لا Merge ولا Production migration']) assert.ok(plan.includes(text));
console.log(`Worklog verified: ${path}`);
