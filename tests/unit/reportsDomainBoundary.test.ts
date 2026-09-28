import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');
const domain = readFileSync('src/api/domains/reporting.ts', 'utf8');
const filters = readFileSync('src/features/reporting/services/reportFilterOptions.ts', 'utf8');
const coreLoaders = readFileSync('src/features/reporting/services/reportCoreLoaders.ts', 'utf8');

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

  it('keeps report filter lookup query construction out of the page component', () => {
    const lookupContracts = [
      ["warehouses", "select('id, name')"],
      ["users", "select('id, full_name, email')"],
      ["customers", "select('id, name, name_en')"],
      ["suppliers", "select('id, name, name_en')"],
      ["products", "select('id, name, name_en')"],
      ["categories", "select('id, name, name_en')"],
      ["dining_tables", "select('id, name')"],
      ["expenses", "select('category')"],
    ] as const;
    for (const [table, select] of lookupContracts) {
      expect(filters).toContain(`.from('${table}')`);
      expect(filters).toContain(select);
    }
    expect(page).toContain('loadReportFilterOptions');
    expect(page).toContain('loadExpenseCategoryOptions');
    expect(page).not.toContain("supabase.from('warehouses').select('id, name')");
    expect(page).not.toContain("supabase.from('users').select('id, full_name, email')");
    expect(page).not.toContain("supabase.from('products').select('id, name, name_en')");
    expect(page).not.toContain("supabase.from('expenses').select('category')");
  });

  it('keeps core sales, purchase and expense query construction out of the page', () => {
    expect(page).toContain('loadSalesReportRows');
    expect(page).toContain('loadPurchaseReportRows');
    expect(page).toContain('loadExpenseReportRows');
    expect(page).not.toContain("select('id, branch_id, invoice_number, subtotal, discount_amount, tax_amount");
    expect(page).not.toContain("supabase.from('purchases').select('id, branch_id, invoice_number, total, returned_amount");
    expect(page).not.toContain("supabase.from('expenses').select('id, branch_id, category, description, amount, expense_date')");
    expect(coreLoaders).toContain(".from('sales')");
    expect(coreLoaders).toContain(".from('purchases')");
    expect(coreLoaders).toContain(".from('expenses')");
  });

  it('keeps the existing report page calling typed domain methods', () => {
    expect(page).toContain('reporting.getDayClosingRangeReport');
    expect(page).toContain('reporting.getRawMaterialConsumptionReport');
    expect(page).toContain('reporting.getCurrentRawMaterialValuation');
    expect(page).toContain('reporting.getRawMaterialFinancialReport');
    expect(page).toContain('reporting.getSalesComponentReconciliationReport');
  });
});
