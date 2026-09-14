import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('global operational branch contract', () => {
  it('uses one required accessible branch instead of widening to all branches', () => {
    const hook = source('src/lib/useBranchFilter.ts');
    expect(hook).toContain('fallbackBranchId');
    expect(hook).not.toContain('all accessible branches');
  });

  it('removes page-local branch selectors from operational pages', () => {
    const checks: Array<[string, string[]]> = [
      ['src/components/Layout.tsx', ['branch-option-all']],
      ['src/features/dashboard/pages/VisualDashboardPage.tsx', ['dashboard-branch-filter', 'setActiveBranchId']],
      ['src/features/pos/pages/ActiveOrdersPage.tsx', ['active-orders-branch-panel', 'setSelectedBranch']],
      ['src/features/trade/pages/ShiftsPage.tsx', ['branchSel', 'setBranchSel']],
      ['src/features/reporting/pages/ReportsPage.tsx', ['adminBranchFilter', 'setAdminBranchFilter']],
      ['src/features/accounting/pages/FinancialReportsPage.tsx', ['reportBranchFilter', 'setReportBranchFilter']],
      ['src/features/accounting/pages/AccountsPage.tsx', ['selectedBranchFilter', 'setSelectedBranchFilter']],
      ['src/features/accounting/pages/PaymentsPage.tsx', ['adminBranchFilter', 'setAdminBranchFilter']],
    ];
    for (const [path, forbidden] of checks) {
      const text = source(path);
      for (const token of forbidden) expect(text, `${path} should not contain ${token}`).not.toContain(token);
    }
  });

  it('keeps cross-branch transfer source and destination explicit and paginated correctly', () => {
    const transfers = source('src/features/inventory/pages/TransfersPage.tsx');
    expect(transfers).toContain('source_branch_id');
    expect(transfers).toContain('destination_branch_id');
    expect(transfers).toContain('from_warehouse_id');
    expect(transfers).toContain('to_warehouse_id');
    expect(transfers).toContain('to_branch_id.eq.${branchFilter}');
  });

  it('POS fullscreen branch switch updates the shared active branch', () => {
    const pos = source('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(pos).toContain('setActiveBranchId(v)');
    expect(pos).not.toContain('setSelectedBranch(v)');
  });

  it('keeps the V2 provider subscribed to the same global branch store', () => {
    const provider = source('src/v2/context/V2BranchContext.tsx');
    expect(provider).toContain('useActiveBranchId()');
    expect(provider).not.toContain('premier:v2:selected-branch');
    expect(provider).not.toContain('window.localStorage');
  });
});
