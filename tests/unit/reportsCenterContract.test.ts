import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const reportsSource = read('src/features/reporting/pages/ReportsPage.tsx');
const reportFilterBarSource = read('src/features/reporting/ReportFilterBar.tsx');
const reportingShellSource = read('src/features/reporting/ReportingShell.tsx');
const deepLinkSource = read('src/features/reporting/pages/ReportDeepLinkPage.tsx');
const financialSource = read('src/features/accounting/pages/FinancialReportsPage.tsx');
const reportFiltersSource = read('src/features/reporting/reportFilters.ts');
const reportExportSource = read('src/lib/reportExport.ts');
const excelSource = read('src/lib/excel.ts');

const OPERATIONAL_KEYS = [
  'sales', 'sales_by_payment', 'sales_by_employee', 'sales_by_product', 'detailed_invoices',
  'purchases', 'expenses', 'profit', 'inventory', 'low_stock',
  'cashier_performance', 'returns', 'production_waste', 'raw_material_consumption',
  'raw_material_current_cost', 'raw_material_financial', 'sales_component_reconciliation', 'daily_closing_range', 'financial_reconciliation',
];

const FINANCIAL_KEYS = [
  'trial_balance', 'ledger', 'treasury_statement', 'inventory_movement', 'income', 'balance_sheet', 'ar_aging', 'ap_aging',
  'aging_summary', 'cash_flow', 'party_statement',
];

describe('Reports Center contract (6H-P4)', () => {
  it('provides a report-type dropdown covering all active operational types', () => {
    expect(reportFilterBarSource).toContain('data-testid="report-type-select"');
    expect(reportFilterBarSource).toContain('data-testid="report-context-filter"');
    expect(reportFilterBarSource).toContain('key={rt.key} value={rt.key}');
    expect(reportFilterBarSource).toContain('key={ft.key} value={ft.key}');
    for (const key of OPERATIONAL_KEYS) {
      expect(reportsSource).toContain(`key: '${key}'`);
    }
  });

  it('exposes financial report types in the dropdown only behind reports.financial permission', () => {
    expect(reportsSource).toContain("can('reports.financial')");
    for (const key of FINANCIAL_KEYS) expect(reportsSource).toContain(`{ key: '${key}'`);
  });

  it('preserves the stable button[data-report-type="<key>"] contract for every report', () => {
    expect(reportFilterBarSource).toContain('data-report-type={rt.key}');
    expect(reportFilterBarSource).toContain('data-report-type={ft.key}');
    expect(deepLinkSource).toContain('button[data-report-type="');
    expect(reportFilterBarSource).toContain('reportTypes.map((rt)');
    expect(reportFilterBarSource).toContain('financialTypes.map((ft)');
  });

  it('keeps /reports?reportType=… deep links resolving to the reports route', () => {
    expect(deepLinkSource).toContain("searchParams.get('reportType')");
    expect(deepLinkSource).toContain('ReportsPage');
  });

  it('preserves financial selections with view + period context through the unified center', () => {
    expect(reportsSource).toContain('const allowed = history.clampRange(from, to)');
    expect(reportsSource).toContain('navigate(`/financial-reports?view=${value}&from=${allowed.from}&to=${allowed.to}`)');
    expect(financialSource).toContain('useSearchParams');
    expect(financialSource).toContain("searchParams.get('view')");
    expect(financialSource).toContain("searchParams.get('from')");
    expect(financialSource).toContain("searchParams.get('to')");
    expect(financialSource).toContain('data-report-type={v.key}');
  });

  it('makes report discovery immediate with visible search and common financial shortcuts', () => {
    expect(reportingShellSource).toContain('type="search"');
    expect(reportingShellSource).toContain("'كل التقارير'");
    expect(reportingShellSource).toContain('QUICK_OPERATIONAL_REPORTS');
    expect(reportingShellSource).toContain("'sales_component_reconciliation'");
    expect(reportingShellSource).toContain("navigate('/reports?section=financial&view=treasury_statement')");
    expect(reportingShellSource).toContain("navigate('/reports?section=financial&view=inventory_movement')");
    expect(reportingShellSource).toContain("can('reports.financial')");
    expect(reportingShellSource).toContain('report.permissions.every');
  });

  it('runs configured filters explicitly instead of re-querying on every filter edit', () => {
    expect(reportFilterBarSource).toContain('data-testid="run-report-button"');
    expect(reportFilterBarSource).toContain("'عرض التقرير'");
    expect(reportFilterBarSource).toContain('pendingChanges');
    expect(reportsSource).toContain('const [queryVersion, setQueryVersion]');
    expect(reportsSource).toContain('const [filtersDirty, setFiltersDirty]');
    expect(reportsSource).toContain('setQueryVersion((version) => version + 1)');
    expect(reportsSource).toContain('[reportType, effectiveBranchFilter, branches, history.unlimited, queryVersion]');
  });

  it('provides a contextual period filter that drives from/to', () => {
    expect(reportFilterBarSource).toContain('value="custom"');
    expect(reportFilterBarSource).toContain('value="today"');
    expect(reportFilterBarSource).toContain('value="yesterday"');
    expect(reportFilterBarSource).toContain('value="last7"');
    expect(reportFilterBarSource).toContain('value="last30"');
    expect(reportFilterBarSource).toContain('value="this_month"');
    expect(reportFilterBarSource).toContain('value="last_month"');
    expect(reportFilterBarSource).toContain('value="this_year"');
    expect(reportFilterBarSource).toContain('onPeriodChange');
  });

  it('shows only the filters relevant to the selected report (ERP-01 §6)', () => {
    expect(reportFilterBarSource).toContain('data-testid="report-contextual-filters"');
    expect(reportFilterBarSource).toContain('data-filter-dim={dim}');
    expect(reportFilterBarSource).toContain('filterDimensions');
    expect(reportFilterBarSource).toContain('showDate');
    expect(reportFiltersSource).toContain('REPORT_FILTER_DIMS');
    expect(reportFiltersSource).toContain('DATE_DRIVEN_REPORTS');
  });

  it('applies contextual filters to real queries via column-scoped builders', () => {
    expect(reportFiltersSource).toContain('applySalesFilters');
    expect(reportFiltersSource).toContain('applySaleItemFilters');
    expect(reportFiltersSource).toContain('applyPurchaseFilters');
    expect(reportFiltersSource).toContain('applyExpenseFilters');
    expect(reportFiltersSource).toContain('applyProductScopedFilters');
    expect(reportsSource).toContain('filterQ(q, filters, applySalesFilters)');
    expect(reportsSource).toContain('filterQ(q, filters, applyPurchaseFilters)');
    expect(reportsSource).toContain('filterQ(q, filters, applyExpenseFilters)');
  });

  it('offers Excel, CSV and print/PDF output from the report page', () => {
    expect(reportsSource).toContain('exportToExcel');
    expect(reportsSource).toContain('downloadCSV');
    expect(reportsSource).toContain('openPrintWindow');
    expect(reportsSource).toContain("t('exportExcel')");
    expect(reportsSource).toContain("t('exportCsv')");
    expect(reportsSource).toContain("t('print')");
    expect(reportExportSource).toContain('downloadCSV');
    expect(reportExportSource).toContain('openPrintWindow');
    expect(reportExportSource).toContain('text/csv;charset=utf-8');
  });

  it('keeps every operational report row branch-identifiable, including all-branch aggregates', () => {
    expect(reportsSource).toContain("const branchColumn = lang === 'ar' ? 'الفرع' : 'Branch'");
    expect(reportsSource).toContain('const withBranch =');
    expect(reportsSource).toContain("select('id, branch_id, invoice_number, total, refunded_amount, status, created_at");
    expect(reportsSource).toContain('reporting.getSalesByPaymentReport');
    expect(reportsSource).toContain('reporting.getFinancialReconciliationReport');
    expect(reportsSource).toContain('fetchAllReportRows');
    expect(reportsSource).toContain('withBranch(row.branchId, {');
    expect(reportsSource).toContain('productBranches.get(row.product_id)');
    expect(reportsSource).toContain('subtitle: `${reportBranchLabel} — ${from} — ${to}`');
    expect(reportsSource).toContain('`${reportBranchLabel} — ${from} - ${to}`');
  });

  it('provides compact grouped navigation and column customization', () => {
    expect(deepLinkSource).toContain('مركز التقارير');
    expect(deepLinkSource).toContain('data-report-nav={key}');
    expect(deepLinkSource).toContain('تخصيص الأعمدة');
    expect(deepLinkSource).toContain('premier.report.columns.');
  });

  it('keeps Excel exports spreadsheet-friendly with widths, filters and frozen headers', () => {
    expect(excelSource).toContain("ws['!cols']");
    expect(excelSource).toContain("ws['!autofilter']");
    expect(excelSource).toContain("ws['!freeze']");
    expect(excelSource).toContain("ws['!margins']");
    expect(excelSource).toContain("'!pageSetup'");
  });

  it('resets contextual filters when switching report type', () => {
    expect(reportsSource).toContain('setFilters({})');
  });
});
