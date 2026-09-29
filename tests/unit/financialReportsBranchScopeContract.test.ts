import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('financial reports branch scope contract', () => {
  it('uses the shared RLS-visible active branch instead of a page-local selector', () => {
    const page = read('src/features/accounting/pages/FinancialReportsPage.tsx');

    expect(page).toContain('const branchFilter = useBranchFilter();');
    expect(page).toContain('const effectiveBranchFilter = branchFilter;');
    expect(page).not.toContain('setReportBranchFilter(');
    expect(page).not.toContain('selectedReportBranch');
    expect(page).not.toContain('isAdminRole(');
    expect(page).not.toContain("t('allBranches')");
  });

  it('keeps every financial RPC and selector read scoped to one explicit accessible branch', () => {
    const page = read('src/features/accounting/pages/FinancialReportsPage.tsx');
    const selectors = read('src/features/accounting/services/financialReportSelectors.ts');

    expect(page).toContain('p_branch_id: effectiveBranchFilter');
    expect(page).toContain('if (!effectiveBranchFilter)');
    expect(page).toContain('loadLedgerAccounts(effectiveBranchFilter)');
    expect(page).toContain('loadTreasuryAccounts(effectiveBranchFilter)');
    expect(page).toContain('loadInventoryStatementOptions(effectiveBranchFilter, inventoryItemType)');
    expect(page).toContain('loadPartyStatementOptions(effectiveBranchFilter, partySide)');
    expect(selectors).toContain(".eq('branch_id', branchId)");
  });
});
