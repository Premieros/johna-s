import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const plan = readFileSync('docs/CURRENT_WORK_PLAN.md', 'utf8');
const pathMatch = plan.match(/Mandatory active work log:\s*`([^`]+)`/i);

describe('mandatory active worklog gate', () => {
  it('declares the mandatory active work log from the unified work plan', () => {
    expect(pathMatch?.[1]).toBe('docs/WORK_AUTHORIZATION_UI_FIRST_2026-09-24.md');
  });

  it('keeps the mandatory log structurally complete', () => {
    const logPath = pathMatch?.[1];
    expect(logPath).toBeTruthy();
    const log = readFileSync(logPath!, 'utf8');

    for (const heading of [
      '## Work status',
      '## Guardrails',
      '## Baseline',
      '## Root-cause ledger',
      '## Change ledger',
      '## Verification ledger',
      '## Production gate',
      '## Next action',
      '## Mandatory update protocol',
    ]) {
      expect(log).toContain(heading);
    }

    expect(log).toContain('Repository: `Premieros/johna-s`');
    expect(log).toContain('Production Supabase: `azzdesuowpdcoflmyezn`');
    expect(log).toMatch(/^Branch:\s*`[^`]+`/m);
    expect(log).toMatch(/^Current PR:\s*`?#?\d+`?/m);
    expect(log).toMatch(/^Last updated:\s*.+$/m);
    expect(log).toContain('State: **BLOCKED**');
  });

  it('matches the PR head branch when running inside pull_request CI', () => {
    const logPath = pathMatch?.[1];
    const log = readFileSync(logPath!, 'utf8');
    const declaredBranch = log.match(/^Branch:\s*`([^`]+)`/m)?.[1];
    const ciHeadBranch = process.env.GITHUB_HEAD_REF;

    if (ciHeadBranch) {
      expect(declaredBranch).toBe(ciHeadBranch);
    } else {
      expect(declaredBranch).toBeTruthy();
    }
  });

  it('requires the unified plan to state the operational rules explicitly', () => {
    expect(plan).toContain('السجل هو المرجع الإجباري للعمل');
    expect(plan).toContain('CI يجب أن يفشل');
    expect(plan).toContain('لا Merge ولا Production migration');
  });
});
