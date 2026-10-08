import type { ReportType } from './reportFilters';
import { getReportExcelProfile } from './reportExcelProfiles';

export interface ReportDataContract { source: string; grainAr: string; grainEn: string; }
export const REPORT_DATA_CONTRACTS: Record<ReportType, ReportDataContract> = {
  sales: { source: 'sales', grainAr: 'فاتورة مبيعات في فرع', grainEn: 'Sales invoice within a branch' },
  purchases: { source: 'purchases', grainAr: 'فاتورة مشتريات في فرع', grainEn: 'Purchase invoice within a branch' },
  expenses: { source: 'expenses (posted)', grainAr: 'مصروف مرحّل', grainEn: 'Posted expense' },
  profit: { source: 'get_income_statement / accounting journals', grainAr: 'ملخص محاسبي للفرع والفترة', grainEn: 'Accounting branch-period summary' },
  inventory: { source: 'inventory_batches + inventory units', grainAr: 'صنف ومخزن وفرع', grainEn: 'Item, warehouse and branch' },
  sales_by_payment: { source: 'get_sales_by_payment_report / sale_payments', grainAr: 'طريقة دفع وفرع', grainEn: 'Payment method and branch' },
  sales_by_employee: { source: 'sales', grainAr: 'موظف وفرع', grainEn: 'Employee and branch' },
  sales_by_station: { source: 'sales + sale_items; settled kitchen events / inventory_ledger for costing', grainAr: 'بند فاتورة موزّع قبل الفلترة', grainEn: 'Invoice line allocated before filtering' },
  sales_by_product: { source: 'sales + sale_items (whole-invoice allocations)', grainAr: 'فرع ومعرف منتج ووحدة بيع', grainEn: 'Branch, product ID and sale unit' },
  detailed_invoices: { source: 'sales + sale_items', grainAr: 'فاتورة مبيعات', grainEn: 'Sales invoice' },
  component_consumption: { source: 'stock_transactions (component_flow sale)', grainAr: 'مكوّن وفرع', grainEn: 'Component and branch' },
  recipe_costs: { source: 'product costing', grainAr: 'منتج وفرع وتكلفة حالية', grainEn: 'Product and branch, current cost' },
  top_consumed_components: { source: 'stock_transactions (component_flow sale)', grainAr: 'مكوّن وفرع', grainEn: 'Component and branch' },
  top_consumed_products: { source: 'sale_items', grainAr: 'منتج وفرع', grainEn: 'Product and branch' },
  low_stock: { source: 'inventory batches / minimum stock', grainAr: 'صنف وفرع', grainEn: 'Item and branch' },
  cashier_performance: { source: 'sales', grainAr: 'أمين صندوق وفرع', grainEn: 'Cashier and branch' },
  returns: { source: 'sales return states', grainAr: 'فاتورة مرتجعة', grainEn: 'Returned invoice' },
  production_waste: { source: 'waste_entries', grainAr: 'حركة هالك', grainEn: 'Waste entry' },
  raw_material_consumption: { source: 'get_raw_material_consumption_report', grainAr: 'خامة وفرع وفترة', grainEn: 'Material, branch and period' },
  raw_material_current_cost: { source: 'canonical current raw cost / FIFO layers', grainAr: 'خامة وفرع وتكلفة حالية', grainEn: 'Material and branch, current cost' },
  raw_material_financial: { source: 'get_raw_material_financial_report', grainAr: 'ملخص مالي للخامات والفرع', grainEn: 'Raw material financial branch summary' },
  sales_component_reconciliation: { source: 'get_sales_component_reconciliation_report', grainAr: 'خامة وفرع ومطابقة فترة', grainEn: 'Material and branch-period reconciliation' },
  daily_closing_range: { source: 'get_day_closing_range_report', grainAr: 'يوم عمل وفرع', grainEn: 'Business day and branch' },
  financial_reconciliation: { source: 'get_financial_reconciliation_report / sale_payments / journals', grainAr: 'فاتورة ومطابقة التحصيل مع القيود', grainEn: 'Invoice with tender-to-journal reconciliation' },
};

export interface AnalysisColumn {
  id: string; key: string; numeric: boolean;
  aggregation: 'sum' | 'none';
}

const aliases: [string, string][] = [
  ['الفرع', 'Branch'], ['الفاتورة', 'Invoice'], ['رقم الفاتورة', 'Invoice'],
  ['المنتج', 'Product'], ['معرف المنتج', 'Product ID'], ['الوحدة', 'Unit'],
  ['المحطة', 'Station'], ['التصنيف', 'Category'], ['الكمية المباعة', 'Sold Quantity'],
  ['الكمية المرتجعة', 'Returned Quantity'], ['صافي الكمية', 'Net Quantity'],
  ['المبيعات قبل الخصم', 'Gross Sales'], ['الخصم الموزع', 'Allocated Discount'],
  ['الضريبة الموزعة', 'Allocated Tax'], ['قيمة المرتجع', 'Return Value'],
  ['صافي الإيراد دون الضريبة', 'Net Revenue Excluding Tax'], ['صافي الإيراد', 'Net Revenue'],
  ['صافي المبيعات', 'Net Sales'], ['الفواتير', 'Invoices'], ['عدد الفواتير', 'Invoices'],
  ['متوسط الفاتورة', 'Avg Invoice'], ['نسبة المرتجعات', 'Refund Rate'],
];

// Additive amounts only. Prices, balances, quantities across units, rates and averages
// are deliberately excluded; their numeric type alone never authorizes summation.
const additive = new Set([
  'Gross Sales', 'Allocated Discount', 'Allocated Tax', 'Return Value', 'Net Revenue Excluding Tax',
  'Net Revenue', 'Net Sales', 'Original Total', 'Invoice Total', 'Refunded', 'Refunded Amount',
  'Subtotal', 'Discount', 'Tax', 'Paid', 'Net Paid', 'Net Collection', 'Returned', 'Net Purchases', 'Amount',
  'COGS', 'Gross Profit', 'Expenses', 'Net Profit', 'Total Cost', 'Consumption Cost', 'Invoices',
]);

export function analysisColumns(type: ReportType, rows: Record<string, unknown>[]): AnalysisColumn[] {
  const ar = getReportExcelProfile(type, 'ar').columns;
  const en = getReportExcelProfile(type, 'en').columns;
  const map = new Map(aliases.flatMap(([a, e]) => [[a, e], [e, e]] as [string, string][]));
  ar.forEach((key, i) => { if (en[i]) map.set(key, en[i]); });
  en.forEach(key => map.set(key, key));
  return Object.keys(rows[0] || {}).map(key => {
    const id = map.get(key) || `${type}:${key}`;
    const numeric = rows.some(row => typeof row[key] === 'number');
    return { id, key, numeric, aggregation: numeric && additive.has(id) ? 'sum' : 'none' };
  });
}
