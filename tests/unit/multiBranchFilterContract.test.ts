import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/lib/useBranchFilter.ts'), 'utf8');

describe('multi-branch filter contract', () => {
  it('uses RLS-visible branches instead of role-name authorization', () => {
    expect(source).toContain('branches.length === 1');
    expect(source).toContain('return branches[0].id');
    expect(source).toContain('return null');
    expect(source).not.toContain('isAdminRole');
  });

  it('never keeps a selected branch that is no longer accessible', () => {
    expect(source).toContain('activeIsAccessible');
    expect(source).toContain('setActiveBranchId(null)');
  });
});
