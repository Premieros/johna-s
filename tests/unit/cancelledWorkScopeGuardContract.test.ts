import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guardrails = readFileSync('docs/EXECUTION_GUARDRAILS.md', 'utf8');
const tombstones = readFileSync('docs/CANCELLED_WORK_SCOPES.md', 'utf8');

describe('cancelled work scope guard', () => {
  it('makes branch existence insufficient authorization', () => {
    expect(guardrails).toContain('branch existence alone is never authorization to execute work');
    expect(guardrails).toContain('cancelled work must not be resumed from a stale branch');
    expect(guardrails).toContain('reactivation requires a **new explicit user request**');
  });

  it('permanently tombstones the mistaken management/treasury restructuring branch', () => {
    expect(tombstones).toContain('development/management-treasury-sheet-20261003');
    expect(tombstones).toContain('**CANCELLED / DO NOT RESUME**');
    expect(tombstones).toContain('dashboard restructuring');
    expect(tombstones).toContain('reports-page restructuring');
    expect(tombstones).toContain('treasury-page restructuring');
  });

  it('requires a fresh explicit request before reactivation', () => {
    expect(tombstones).toContain('A cancelled scope may resume only after a **new explicit user request**');
    expect(tombstones).toContain('Reactivation requirement: a fresh explicit user request');
  });
});
