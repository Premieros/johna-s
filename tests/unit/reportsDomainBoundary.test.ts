import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');
const domain = readFileSync('src/api/domains/reporting.ts', 'utf8');
const filters = readFileSync('src/features/reporting/services/reportFilterOptions.ts', 'utf8');

const rpcNames = [
  'get_day_closing_range_report',
  'get_raw_material_consumption_report',
  'get_current_raw_material_valuation',
  'get_raw_material_financial_report',
  'get_sales_component_reconciliation_report',
] as const;

describe('reports domain boundary', () => {
  it('keeps heavy report RPC ownership in the reporting domain', () => {
    for (const name of rpcNames) {
      expect(domain).toContain(`rpc('${name}', p)`);
      expect(page).not.toContain(`supabase.rpc('${name}'`);
    }
  });

  it('keeps report filter lookup queries out of the page component', () => {
    for (const table of ['warehouses', 'users', 'customers', 'suppliers', 'products', 'categories', 'dining_tables', 'expenses']) {
      expect(page).not.toContain(`supabase.from('${table}')`);
      expect(filters).toContain(`supabase.from('${table}')`);
    }
    expect(page).toContain('loadReportFilterOptions');
    expect(page).toContain('loadExpenseCategoryOptions');
  });

  it('keeps the existing report page calling typed domain methods', () => {
    expect(page).toContain('reporting.getDayClosingRangeReport');
    expect(page).toContain('reporting.getRawMaterialConsumptionReport');
    expect(page).toContain('reporting.getCurrentRawMaterialValuation');
    expect(page).toContain('reporting.getRawMaterialFinancialReport');
    expect(page).toContain('reporting.getSalesComponentReconciliationReport');
  });
});
