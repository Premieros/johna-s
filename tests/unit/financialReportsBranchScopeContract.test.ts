import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('financial reports branch scope contract', () => {
  it('uses RLS-visible branches instead of operational role labels', () => {
    const page = read('src/features/accounting/pages/FinancialReportsPage.tsx');

    expect(page).toContain('const { branches } = useBranches();');
    expect(page).toContain('branches.length > 1');
    expect(page).toContain('setReportBranchFilter(e.target.value)');
    expect(page).toContain('selectedReportBranch || branchFilter || (branches.length === 1 ? branches[0].id : null)');
    expect(page).not.toContain('isAdminRole(');
    expect(page).not.toContain("t('allBranches')");
  });

  it('keeps every financial RPC scoped to one explicit accessible branch', () => {
    const page = read('src/features/accounting/pages/FinancialReportsPage.tsx');

    expect(page).toContain('p_branch_id: effectiveBranchFilter');
    expect(page).toContain('if (!effectiveBranchFilter)');
    expect(page).toContain(".eq('branch_id', effectiveBranchFilter)");
  });
});
