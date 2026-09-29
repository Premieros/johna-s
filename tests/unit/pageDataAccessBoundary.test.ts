import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const pagesRoot = join(repoRoot, 'src', 'features');

const legacyAllowlist = new Set([
  "src/features/accounting/pages/AccountsPage.tsx",
  "src/features/accounting/pages/EmployeeReceivablesPage.tsx",
  "src/features/accounting/pages/FinancialReportsPage.tsx",
  "src/features/admin/pages/ApprovalCenterPage.tsx",
  "src/features/admin/pages/SettingsControlCenterPage.tsx",
  "src/features/admin/pages/SuperAdminConsolePage.tsx",
  "src/features/admin/pages/UsersPage.tsx",
  "src/features/catalog/pages/CategoriesPage.tsx",
  "src/features/catalog/pages/InventoryUnitsPage.tsx",
  "src/features/catalog/pages/ProductModifiersPage.tsx",
  "src/features/catalog/pages/ProductSetupWizardPage.tsx",
  "src/features/catalog/pages/ProductsPage.tsx",
  "src/features/catalog/pages/PricingPage.tsx",
  "src/features/costing/pages/CostingCenterPage.tsx",
  "src/features/dashboard/pages/DashboardDataPage.tsx",
  "src/features/dashboard/pages/DashboardExecutiveInsightsV2.tsx",
  "src/features/dashboard/pages/VisualDashboardPage.tsx",
  "src/features/import-export/pages/ImportExportCenterPage.tsx",
  "src/features/inventory/pages/KitchenDisplayPage.tsx",
  "src/features/inventory/pages/LowStockAlertsPage.tsx",
  "src/features/inventory/pages/StockCountsPage.tsx",
  "src/features/inventory/pages/StockValuationPage.tsx",
  "src/features/inventory/pages/TransfersPage.tsx",
  "src/features/inventory/pages/WarehousesPage.tsx",
  "src/features/inventory/pages/WasteCenterPage.tsx",
  "src/features/manufacturing/pages/RawMaterialsPage.tsx",
  "src/features/manufacturing/pages/RecipesPage.tsx",
  "src/features/parties/pages/CustomersPage.tsx",
  "src/features/parties/pages/SuppliersPage.tsx",
  "src/features/pos/pages/ActiveOrdersPage.tsx",
  "src/features/pos/pages/PosWorkspacePage.tsx",
  "src/features/trade/pages/PurchaseRequestsPage.tsx",
  "src/features/trade/pages/PurchasesPage.tsx",
  "src/features/trade/pages/RfqsPage.tsx",
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
