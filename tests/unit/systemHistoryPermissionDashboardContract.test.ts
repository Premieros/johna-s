import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('permission-aware dashboard and system history contract', () => {
  it('registers one canonical unlimited-history capability', () => {
    const permissions = read('src/lib/permissionDefs.ts');
    expect(permissions).toContain("'history.unlimited'");
    expect(permissions).toContain("عرض السجل التاريخي الكامل");
    expect(permissions).toContain("Historical Data Access");
  });

  it('renders only the requested operational dashboard KPIs', () => {
    const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');
    expect(dashboard).toContain("can('pos.view')");
    expect(dashboard).toContain("can('sales.view')");
    expect(dashboard).toContain("can('inventory.view')");
    expect(dashboard).toContain("can('purchases.view')");
    expect(dashboard).toContain("can('expenses.view')");
    expect(dashboard).toContain('testId="kpi-open-order-value"');
    expect(dashboard).toContain('testId="kpi-discounts"');
    expect(dashboard).toContain('testId="kpi-returns"');
    expect(dashboard).toContain('testId="kpi-expenses"');
    expect(dashboard).toContain('openOrderValue: activeOrders.reduce');
    expect(dashboard).toContain('current.discounts');
    expect(dashboard).toContain('current.returns');
    expect(dashboard).toContain('data-testid={testId}');
    expect(dashboard).toContain("status', ['open', 'held']");
    expect(dashboard).not.toContain('testId="kpi-open-orders"');
    expect(dashboard).not.toContain('testId="kpi-net-sales"');
    expect(dashboard).not.toContain('testId="kpi-occupied-tables"');
    expect(dashboard).not.toContain('testId="kpi-available-tables"');
    expect(dashboard).not.toContain('testId="kpi-open-shifts"');
    expect(dashboard).not.toContain('testId="kpi-active-users"');
    expect(dashboard).not.toContain("supabase.from('dining_tables')");
    expect(dashboard).not.toContain("supabase.from('shifts')");
    expect(dashboard).not.toContain("supabase.from('users')");
    expect(dashboard).not.toContain('aria-disabled="true"');
    expect(dashboard).not.toContain("role === 'branch_manager'");
    expect(dashboard).not.toContain("role === 'accountant'");
  });

  it('keeps the seven-day guard on historical transaction screens', () => {
    const expectations: Array<[string, string]> = [
      ['src/features/trade/pages/PurchasesPage.tsx', 'history.minIso'],
      ['src/features/trade/pages/ExpensesPage.tsx', 'history.minDate'],
      ['src/features/trade/pages/ShiftsPage.tsx', 'status.eq.open'],
      ['src/features/inventory/pages/TransfersPage.tsx', 'status.eq.pending'],
      ['src/features/trade/pages/PurchaseRequestsPage.tsx', 'status.in.(draft,submitted,approved)'],
      ['src/features/trade/pages/RfqsPage.tsx', 'status.in.(draft,sent,received)'],
      ['src/features/inventory/pages/StockCountsPage.tsx', 'status.in.(draft,submitted,approved)'],
      ['src/features/manufacturing/pages/ProductionOrdersPage.tsx', 'status.in.(planned,in_progress)'],
      ['src/features/accounting/pages/ReconciliationPage.tsx', 'status.eq.open'],
      ['src/features/accounting/pages/PaymentsPage.tsx', 'history.minIso'],
      ['src/features/accounting/pages/TreasuryPage.tsx', 'history.minIso'],
      ['src/features/inventory/pages/InventoryLedgerPage.tsx', 'history.minIso'],
      ['src/features/reporting/pages/AuditLogPage.tsx', 'history.minIso'],
    ];

    for (const [path, marker] of expectations) {
      expect(read(path), path).toContain(marker);
    }

    const sales = read('src/features/trade/pages/SalesPage.tsx');
    expect(sales).not.toContain('history.minIso');
    expect(sales).not.toContain('useHistoryAccess');
  });

  it('does not date-limit master/current-data catalogs', () => {
    for (const path of [
      'src/features/catalog/pages/ProductsPage.tsx',
      'src/features/parties/pages/CustomersPage.tsx',
      'src/features/parties/pages/SuppliersPage.tsx',
      'src/features/inventory/pages/WarehousesPage.tsx',
      'src/features/admin/pages/BranchesPage.tsx',
    ]) {
      expect(read(path), path).not.toContain('useHistoryAccess');
    }
  });
});
