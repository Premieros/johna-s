import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/lib/useBranchFilter.ts'), 'utf8');

describe('multi-branch filter contract', () => {
  it('pins operational pages to one RLS-visible branch without role-name authorization', () => {
    expect(source).toContain('useBranches');
    expect(source).toContain('activeIsAccessible');
    expect(source).toContain('primaryIsAccessible');
    expect(source).toContain('fallbackBranchId');
    expect(source).toContain('return fallbackBranchId');
    expect(source).not.toContain('isAdminRole');
  });

  it('repairs an inaccessible active branch to an accessible fallback instead of widening scope', () => {
    expect(source).toContain('if (!user || loading || activeIsAccessible) return;');
    expect(source).toContain('setActiveBranchId(fallbackBranchId)');
    expect(source).not.toContain('setActiveBranchId(null)');
  });
});
