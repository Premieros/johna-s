import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('recovery and release resilience contract', () => {
  const runbook = readFileSync('docs/RECOVERY_RELEASE_RESILIENCE_2026-09-29.md', 'utf8');

  it('requires restore rehearsal on an isolated Fresh/Test database', () => {
    expect(runbook).toContain('Fresh/Test database');
    expect(runbook).toContain('Never use Production as the rehearsal target');
    expect(runbook).toContain('node scripts/db/verify-schema.js');
    expect(runbook).toContain('npm run verify:full');
    expect(runbook).toContain('functional_core_cycle.test.ts');
  });

  it('keeps database recovery forward-only', () => {
    expect(runbook).toContain('Applied migrations are immutable history');
    expect(runbook).toContain('new forward-only migration');
    expect(runbook).toContain('Do not automatically downgrade database schema');
  });

  it('keeps Print Agent recovery independent', () => {
    expect(runbook).toContain('development/cleopatra-v811-final');
    expect(runbook).toContain('development/smouha-v811-realtime-final');
    expect(runbook).toContain('cross-branch isolation');
  });

  it('requires final verification and explicit approval', () => {
    expect(runbook).toContain('exact-head Fast Verify Green');
    expect(runbook).toContain('exact-head Full Verify Green');
    expect(runbook).toContain('Production API parity Green');
    expect(runbook).toContain('explicit user approval');
  });
});
