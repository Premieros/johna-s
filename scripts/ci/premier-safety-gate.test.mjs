import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSafety } from './premier-safety-gate.mjs';

const complete = [
  'Impact: Changes only the isolated report read path, with tenant and branch scope preserved.',
  'Verification: Focused report tests passed; physical printer output not claimed.',
  'Rollback: Disable the branch-scoped flag and revert the code; no schema change.',
  'Production status: Requires separate approval',
].join('\n');

test('isolated docs are not high risk', () => {
  assert.deepEqual(evaluateSafety(['docs/EXAMPLE.md'], ''), { highRisk: false, agentFiles: [], errors: [] });
});

test('critical printing paths require concrete declarations', () => {
  const result = evaluateSafety(['src/features/trade/services/automaticShiftPrint.ts'], '');
  assert.equal(result.highRisk, true);
  assert.equal(result.errors.length, 4);
});

test('high-risk change with a filled review is allowed into existing CI', () => {
  assert.deepEqual(evaluateSafety(['supabase/migrations/20261106_safety.sql'], complete).errors, []);
});

test('placeholders cannot satisfy a high-risk safety review', () => {
  const result = evaluateSafety(['.github/workflows/verify-main.yml'],
    'Impact: [describe]\nVerification: TODO\nRollback: [fill in]\nProduction status: No production changes');
  assert.equal(result.errors.length, 3);
});

test('restaurant agent edits remain blocked despite a completed declaration', () => {
  const result = evaluateSafety(['print-agent-v8/CloudPrintWorker.cs'], complete);
  assert.equal(result.agentFiles.length, 1);
  assert.equal(result.errors.length, 1);
});

test('unrelated application changes do not add review work', () => {
  assert.equal(evaluateSafety(['src/components/Sidebar.tsx'], '').highRisk, false);
});
