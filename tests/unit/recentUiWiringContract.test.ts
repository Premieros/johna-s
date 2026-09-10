import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Recent UI wiring contracts', () => {
  it('persists branch status edits and uses permanent branch deletion', () => {
    const page = source('src/features/admin/pages/BranchesPage.tsx');
    expect(page).toContain('p_is_active: form.is_active');
    expect(page).toContain('branchesApi.remove({ p_branch_id: deleteId })');
    expect(page).toContain("'حذف الفرع نهائيًا'");
  });

  it('keeps the costing sales summary wired to the COGS ratio card', () => {
    const page = source('src/features/costing/pages/CostingCenterPage.tsx');
    expect(page).toContain('api.costing.getSalesSummary');
    expect(page).toContain('salesCostSummary.ratio');
    expect(page).toContain('salesCostSummary.cogs');
    expect(page).toContain('salesCostSummary.net_sales');
  });

  it('keeps simplified role selection, search and grouped permission controls', () => {
    const page = source('src/features/admin/pages/RolesTab.tsx');
    expect(page).toContain('permissionSearch');
    expect(page).toContain('setGroup(currentRole, group.permissions, !groupAll)');
    expect(page).toContain('setAll(currentRole, true)');
    expect(page).toContain('save(currentRole)');
  });

  it('keeps the fixed header back button available away from dashboard', () => {
    const page = source('src/components/Layout.tsx');
    expect(page).toContain("const showBackButton = location.pathname !== APP_ROUTES.dashboard");
    expect(page).toContain('data-testid="header-back-button"');
  });

  it('keeps the compact reports selector contract and contextual filters', () => {
    const page = source('src/features/reporting/ReportFilterBar.tsx');
    expect(page).toContain('data-testid="report-type-select"');
    expect(page).toContain('data-testid="report-context-filter"');
    expect(page).toContain('data-testid="report-contextual-filters"');
  });

  it('keeps POS cart additions blocked until the active shift check and stock verification pass', () => {
    const page = source('src/features/pos/components/catalog/ProductBrowser.tsx');
    expect(page).toContain('const canAddToCart = canModifyOrder && hasBranch && shiftChecked && shiftOpen');
    expect(page).toContain('ممنوع إضافة منتجات بدون شفت مفتوح');
    expect(page).toContain('if (!canAddToCart || !ensureSellable(product)) return;');
    expect(page).toContain('if (!hasStockValue(source, product.id))');
    expect(page).toContain('if ((source[product.id] || 0) <= 0)');
  });
});
