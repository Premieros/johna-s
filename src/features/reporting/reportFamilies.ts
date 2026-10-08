import type { ReportType } from './reportFilters';

export const REPORT_FAMILIES = [
  { key: 'sales', ar: 'المبيعات والمرتجعات', en: 'Sales & Returns' },
  { key: 'purchases', ar: 'المشتريات', en: 'Purchases' },
  { key: 'expenses', ar: 'المصروفات', en: 'Expenses' },
  { key: 'inventory', ar: 'المخزون وحركة الخامات', en: 'Inventory & Materials' },
  { key: 'costing', ar: 'التكلفة والاستهلاك والهالك', en: 'Cost, Consumption & Waste' },
  { key: 'employees', ar: 'الموظفون والأداء', en: 'Employees & Performance' },
  { key: 'payments', ar: 'الخزينة والمدفوعات', en: 'Treasury & Payments' },
  { key: 'financial', ar: 'المحاسبة والذمم', en: 'Accounting & Receivables' },
] as const;

export type ReportFamily = typeof REPORT_FAMILIES[number]['key'];
export type FinancialReportView = 'trial_balance' | 'ledger' | 'treasury_statement'
  | 'inventory_movement' | 'income' | 'balance_sheet' | 'ar_aging' | 'ap_aging'
  | 'aging_summary' | 'cash_flow' | 'party_statement';

// Every existing report keeps its route and source; families only organize discovery.
export const OPERATIONAL_REPORT_FAMILIES: Record<ReportType, ReportFamily> = {
  sales: 'sales', sales_by_station: 'sales', sales_by_product: 'sales',
  detailed_invoices: 'sales', top_consumed_products: 'sales', returns: 'sales',
  sales_by_payment: 'payments', daily_closing_range: 'payments', financial_reconciliation: 'payments',
  sales_by_employee: 'employees', cashier_performance: 'employees',
  purchases: 'purchases', expenses: 'expenses',
  inventory: 'inventory', low_stock: 'inventory', raw_material_consumption: 'inventory',
  raw_material_current_cost: 'costing', component_consumption: 'costing', recipe_costs: 'costing',
  top_consumed_components: 'costing', production_waste: 'costing', sales_component_reconciliation: 'costing',
  profit: 'financial', raw_material_financial: 'financial',
};

export const FINANCIAL_REPORT_FAMILIES: Record<FinancialReportView, ReportFamily> = {
  treasury_statement: 'payments', inventory_movement: 'inventory',
  trial_balance: 'financial', ledger: 'financial', income: 'financial', balance_sheet: 'financial',
  ar_aging: 'financial', ap_aging: 'financial', aging_summary: 'financial',
  cash_flow: 'financial', party_statement: 'financial',
};

/** Call after permission and search filtering so empty/unauthorized families never appear. */
export function getVisibleReportFamilies(operational: readonly { key: ReportType }[], financial: readonly { key: FinancialReportView }[]) {
  return REPORT_FAMILIES.filter(family =>
    operational.some(report => OPERATIONAL_REPORT_FAMILIES[report.key] === family.key)
    || financial.some(report => FINANCIAL_REPORT_FAMILIES[report.key] === family.key),
  );
}
