import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const pagesRoot = join(repoRoot, 'src', 'features');

const legacyAllowlist = new Set([
  "src/features/admin/pages/ApprovalCenterPage.tsx",
  "src/features/admin/pages/SuperAdminConsolePage.tsx",
  "src/features/catalog/pages/ProductsPage.tsx",
  "src/features/inventory/pages/KitchenDisplayPage.tsx",
  "src/features/inventory/pages/WasteCenterPage.tsx",
  "src/features/manufacturing/pages/RecipesPage.tsx",
  "src/features/pos/pages/ActiveOrdersPage.tsx",
  "src/features/pos/pages/PosWorkspacePage.tsx",
  "src/features/trade/pages/SalesPage.tsx",
  "src/features/trade/pages/ShiftsPage.tsx"
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\/pages\/.*\.(ts|tsx)$/.test(full.replace(/\\/g, '/')) ? [full] : [];
  });
}

describe('page data-access architecture boundary', () => {
  it('does not allow new page components to talk directly to Supabase', () => {
    const directPages = walk(pagesRoot)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return /supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source);
      })
      .map((path) => relative(repoRoot, path).replace(/\\/g, '/'))
      .sort();

    const unexpected = directPages.filter((path) => !legacyAllowlist.has(path));

    expect(unexpected, 'Move new page data access behind src/api/domains or a feature service').toEqual([]);
    expect(directPages.length).toBeLessThanOrEqual(legacyAllowlist.size);
  });

  it('keeps StockCountsPage behind its metadata service', () => {
    const stockCounts = readFileSync(join(repoRoot, 'src/features/inventory/pages/StockCountsPage.tsx'), 'utf8');
    expect(stockCounts).toContain('loadStockCountMetadata');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(stockCounts)).toBe(false);
  });

  it('keeps LowStockAlertsPage behind its read-only feature service', () => {
    const lowStock = readFileSync(join(repoRoot, 'src/features/inventory/pages/LowStockAlertsPage.tsx'), 'utf8');
    expect(lowStock).toContain('loadLowStockOptions');
    expect(lowStock).toContain('loadRawMaterialReorderRows');
    expect(lowStock).toContain('loadProductCostMap');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(lowStock)).toBe(false);
  });

  it('keeps FinancialReportsPage behind selector services/domain APIs', () => {
    const financialReports = readFileSync(join(repoRoot, 'src/features/accounting/pages/FinancialReportsPage.tsx'), 'utf8');
    expect(financialReports).toContain('loadLedgerAccounts');
    expect(financialReports).toContain('loadInventoryStatementOptions');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(financialReports)).toBe(false);
  });

  it('keeps InventoryUnitsPage behind its feature service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/catalog/pages/InventoryUnitsPage.tsx'), 'utf8');
    expect(source).toContain('loadInventoryUnitComponents');
    expect(source).toContain('saveInventoryUnit');
    expect(source).toContain('saveInventoryUnitComponents');
    expect(source).toContain('deleteComponentGroup');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps RawMaterialsPage behind its feature service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/manufacturing/pages/RawMaterialsPage.tsx'), 'utf8');
    expect(source).toContain('loadRawMaterialMeta');
    expect(source).toContain('updateRawMaterial');
    expect(source).toContain('deleteRawMaterial');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps UsersPage behind its access service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/admin/pages/UsersPage.tsx'), 'utf8');
    expect(source).toContain('loadUserBranchAccess');
    expect(source).toContain('saveUserBranchAccess');
    expect(source).toContain('updateUserProfile');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps EmployeeReceivablesPage behind its accounting service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/accounting/pages/EmployeeReceivablesPage.tsx'), 'utf8');
    expect(source).toContain('loadEmployeeReceivableRows');
    expect(source).toContain('createEmployeeCustomer');
    expect(source).toContain('receiveEmployeeReceivablePayment');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps AccountsPage behind its feature service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/accounting/pages/AccountsPage.tsx'), 'utf8');
    expect(source).toContain('saveAccount');
    expect(source).toContain('deleteAccount');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps ProductSetupWizardPage behind its data service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/catalog/pages/ProductSetupWizardPage.tsx'), 'utf8');
    expect(source).toContain('loadProductSetupChoices');
    expect(source).toContain('deleteProductSetupRollback');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps simple master-data pages behind feature services', () => {
    const checks = [
      ['src/features/catalog/pages/CategoriesPage.tsx', 'saveCategory'],
      ['src/features/inventory/pages/WarehousesPage.tsx', 'saveWarehouse'],
      ['src/features/parties/pages/CustomersPage.tsx', 'saveCustomer'],
      ['src/features/parties/pages/SuppliersPage.tsx', 'saveSupplier'],
    ] as const;
    for (const [relativePath, marker] of checks) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      expect(source).toContain(marker);
      expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
    }
  });

  it('keeps VisualDashboardPage behind dashboard services', () => {
    const source = readFileSync(join(repoRoot, 'src/features/dashboard/pages/VisualDashboardPage.tsx'), 'utf8');
    expect(source).toContain('loadVisualDashboardCore');
    expect(source).toContain('loadVisualDashboardMonthlyRows');
    expect(source).toContain('loadDashboardPaymentAggregates');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps DashboardDataPage behind dashboard services', () => {
    const source = readFileSync(join(repoRoot, 'src/features/dashboard/pages/DashboardDataPage.tsx'), 'utf8');
    expect(source).toContain('loadDashboardSalesSnapshot');
    expect(source).toContain('loadDashboardFallbackSales');
    expect(source).toContain('loadDashboardStockRows');
    expect(source).toContain('loadDashboardOpsRows');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps PricingPage behind its data service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/catalog/pages/PricingPage.tsx'), 'utf8');
    expect(source).toContain('loadPricingRows');
    expect(source).toContain('updateManufacturedPricing');
    expect(source).toContain('updateProductPricing');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps ProductModifiersPage behind selector services', () => {
    const source = readFileSync(join(repoRoot, 'src/features/catalog/pages/ProductModifiersPage.tsx'), 'utf8');
    expect(source).toContain('loadProductModifierSelectors');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps CostingCenterPage behind selector services', () => {
    const source = readFileSync(join(repoRoot, 'src/features/costing/pages/CostingCenterPage.tsx'), 'utf8');
    expect(source).toContain('loadCostingBranches');
    expect(source).toContain('loadCostingSuppliers');
    expect(source).toContain('loadRawMaterialUnitDisplayMap');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps PurchaseRequestsPage behind its data service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/trade/pages/PurchaseRequestsPage.tsx'), 'utf8');
    expect(source).toContain('loadPurchaseRequestMeta');
    expect(source).toContain('loadPurchaseRequestItems');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps RfqsPage behind its data service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/trade/pages/RfqsPage.tsx'), 'utf8');
    expect(source).toContain('loadRfqMeta');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps TransfersPage behind its data service', () => {
    const source = readFileSync(join(repoRoot, 'src/features/inventory/pages/TransfersPage.tsx'), 'utf8');
    expect(source).toContain('loadTransferMeta');
    expect(source).toContain('loadTransferAverageCost');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(source)).toBe(false);
  });

  it('keeps DashboardExecutiveInsightsV2 behind its data service', () => {
    const dashboard = readFileSync(join(repoRoot, 'src/features/dashboard/pages/DashboardExecutiveInsightsV2.tsx'), 'utf8');
    expect(dashboard).toContain('loadExecutiveInsightsData');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(dashboard)).toBe(false);
  });

  it('keeps ImportExportCenterPage behind its validation context service', () => {
    const importExport = readFileSync(join(repoRoot, 'src/features/import-export/pages/ImportExportCenterPage.tsx'), 'utf8');
    expect(importExport).toContain('loadImportExportValidationContext');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(importExport)).toBe(false);
  });

  it('keeps PurchasesPage behind its trade data service', () => {
    const purchases = readFileSync(join(repoRoot, 'src/features/trade/pages/PurchasesPage.tsx'), 'utf8');
    expect(purchases).toContain('fetchPurchaseMeta');
    expect(purchases).toContain('createPurchaseRawMaterial');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(purchases)).toBe(false);
  });

  it('keeps ReportsPage behind feature services/domain boundaries', () => {
    const reports = readFileSync(join(repoRoot, 'src/features/reporting/pages/ReportsPage.tsx'), 'utf8');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(reports)).toBe(false);
  });

  it('keeps System Health behind the admin domain boundary', () => {
    const health = readFileSync(join(repoRoot, 'src/features/admin/pages/SystemHealthPage.tsx'), 'utf8');
    expect(health).toContain('admin.getSystemHealthSnapshot');
    expect(/supabase\s*\.\s*(?:from|rpc)\s*\(/.test(health)).toBe(false);
  });
});
