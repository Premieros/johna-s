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
      ['src/features/trade/pages/PurchaseRequestsPage.tsx', ["label={t('branch')} value={form.branch_id}", 'user?.branch_id']],
      ['src/features/trade/pages/RfqsPage.tsx', ["label={t('branch')} value={form.branch_id}", 'user?.branch_id']],
      ['src/features/trade/pages/PurchasesPage.tsx', ["label={t('branch')} value={form.branch_id}", 'user?.branch_id']],
      ['src/features/inventory/pages/InventoryLedgerPage.tsx', ['setBranchId', "t('allBranches')"]],
      ['src/features/inventory/pages/StockCountsPage.tsx', ['setBranchId', "t('allBranches')"]],
      ['src/features/inventory/pages/InventoryBatchesPage.tsx', ['setBranchId', "t('allBranches')"]],
      ['src/features/inventory/pages/StockValuationPage.tsx', ['setBranchId', "t('allBranches')"]],
      ['src/features/inventory/pages/LowStockAlertsPage.tsx', ['setBranchId', 'changeReorderBranch', "t('allBranches')"]],
      ['src/features/manufacturing/pages/RawMaterialsPage.tsx', ['stockBranch', 'raw-materials-branch-panel']],
      ['src/features/costing/pages/CostingCenterPage.tsx', ['setBranchId', "t('allBranches')"]],
      ['src/features/accounting/pages/JournalPage.tsx', ['selectedBranchFilter', 'setSelectedBranchFilter']],
      ['src/features/accounting/pages/TreasuryPage.tsx', ['adminBranchFilter', 'setAdminBranchFilter', 'isAdminRole']],
      ['src/features/accounting/pages/ReconciliationPage.tsx', ['adminBranchFilter', 'setAdminBranchFilter', 'isAdminRole']],
    ];
    for (const [path, forbidden] of checks) {
      const text = source(path);
      for (const token of forbidden) expect(text, `${path} should not contain ${token}`).not.toContain(token);
    }
  });

  it('scopes operational metadata and writes to the shared active branch', () => {
    const requests = source('src/features/trade/pages/PurchaseRequestsPage.tsx');
    expect(requests).toContain(".eq('branch_id', branchFilter)");
    expect(requests).toContain('p_branch_id: branchFilter');

    const rfqs = source('src/features/trade/pages/RfqsPage.tsx');
    expect(rfqs).toContain(".eq('branch_id', branchFilter)");
    expect(rfqs).toContain('p_branch_id: branchFilter');

    const purchases = source('src/features/trade/pages/PurchasesPage.tsx');
    expect(purchases).toContain('p_branch_id: branchFilter');

    const ledger = source('src/features/inventory/pages/InventoryLedgerPage.tsx');
    expect(ledger).toContain('branch_id: branchFilter');

    const counts = source('src/features/inventory/pages/StockCountsPage.tsx');
    expect(counts).toContain('branch_id: branchFilter');

    const batches = source('src/features/inventory/pages/InventoryBatchesPage.tsx');
    expect(batches).toContain('branch_id: branchFilter');

    const sales = source('src/features/trade/pages/SalesPage.tsx');
    expect(sales).toContain("from('customers').select('*').eq('branch_id', branchFilter)");
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
});
