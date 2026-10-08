import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');
const domain = readFileSync('src/api/domains/reporting.ts', 'utf8');
const filters = readFileSync('src/features/reporting/services/reportFilterOptions.ts', 'utf8');
const optionsHook = readFileSync('src/features/reporting/useReportFilterOptions.ts', 'utf8');
const coreLoaders = readFileSync('src/features/reporting/services/reportCoreLoaders.ts', 'utf8');
const salesLoaders = readFileSync('src/features/reporting/services/reportSalesLoaders.ts', 'utf8');
const inventoryLoaders = readFileSync('src/features/reporting/services/reportInventoryLoaders.ts', 'utf8');

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
      expect(domain).toMatch(new RegExp(`rpc\\('${name}', p(?:, signal)?\\)`));
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
    expect(page).toContain('useReportFilterOptions');
    expect(optionsHook).toContain('loadReportFilterOptions');
    expect(optionsHook).toContain('loadExpenseCategoryOptions');
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
    expect(coreLoaders).toContain('reporting.getOperationalReportDataset');
    expect(coreLoaders).not.toContain('.from(');
    expect(domain).toContain("rpc('get_operational_report_dataset', p, signal)");
  });

  it('keeps secondary sales report query construction out of the page', () => {
    expect(page).toContain('loadSalesByEmployeeRows');
    expect(page).toContain('loadDetailedInvoiceRows');
    expect(page).toContain('loadCashierPerformanceRows');
    expect(page).toContain('loadReturnRows');

    expect(page).not.toContain("select('branch_id, cashier_id, total, refunded_amount, users:users!fk_sales_cashier(full_name, email)')");
    expect(page).not.toContain("select('id, branch_id, invoice_number, total, paid_amount, refunded_amount, payment_method, status, created_at");
    expect(page).not.toContain("status.in.(returned,refunded,cancelled)");

    expect(salesLoaders).not.toContain('.from(');
    expect(salesLoaders).toContain('loadSalesReportRows');
    expect(salesLoaders).toContain('users: sale.cashier');
  });

  it('keeps inventory, item, low-stock and waste query construction out of the page', () => {
    expect(page).not.toContain('supabase.from(');
    expect(page).not.toContain('fetchAllReportRows');
    expect(page).toContain('loadProductSalesSummary');
    expect(page).toContain('loadTopConsumedProductItems');
    expect(page).toContain('loadComponentConsumptionRows');
    expect(page).toContain('loadTopConsumedComponentRows');
    expect(page).toContain('loadLowStockSources');
    expect(page).toContain('loadInventoryBatchRows');
    expect(page).toContain('loadWasteRows');
    expect(inventoryLoaders).toContain('loadProductSalesSummary');
    expect(inventoryLoaders).not.toContain(".from('sale_items')");
    expect(inventoryLoaders).toContain(".from('stock_transactions')");
    expect(inventoryLoaders).toContain('reporting.getOperationalStockSource');
    expect(inventoryLoaders).not.toContain(".from('raw_material_inventory')");
    expect(inventoryLoaders).not.toContain(".from('raw_material_batches')");
    expect(inventoryLoaders).toContain(".from('waste_entries')");
  });

  it('keeps the existing report page calling typed domain methods', () => {
    expect(page).toContain('reporting.getDayClosingRangeReport');
    expect(page).toContain('reporting.getRawMaterialConsumptionReport');
    expect(page).toContain('reporting.getCurrentRawMaterialValuation');
    expect(page).toContain('reporting.getRawMaterialFinancialReport');
    expect(page).toContain('reporting.getSalesComponentReconciliationReport');
  });
});
