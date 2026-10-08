import { REPORT_REGISTRY } from './reportRegistry';
import type { ReportType } from './reportFilters';
import type { FinancialReportView } from './reportFamilies';

export type WorkspaceView = { key: string; type?: ReportType; financial?: FinancialReportView; ar: string; en: string; permissions: string[] };
export type BasicReport = { key: string; ar: string; en: string; descriptionAr: string; descriptionEn: string; views: WorkspaceView[] };
const op = (type: ReportType, ar: string, en: string): WorkspaceView => ({ key: type, type, ar, en, permissions: REPORT_REGISTRY.find(r => r.key === type)!.permissions });
const financial = (view: FinancialReportView, ar: string, en: string): WorkspaceView => ({ key: `financial:${view}`, financial: view, ar, en, permissions: ['reports.financial'] });

export const BASIC_REPORTS: BasicReport[] = [
  { key: 'sales', ar: 'المبيعات', en: 'Sales', descriptionAr: 'الفواتير والأصناف والمرتجعات وأداء الموظفين', descriptionEn: 'Invoices, items, returns and employee performance', views: [
    op('sales', 'الفواتير', 'Invoices'), op('sales_by_product', 'ملخص الأصناف', 'Item summary'),
    op('sales_by_station', 'تفاصيل الأصناف والمحطات', 'Items & stations'), op('cashier_performance', 'أداء الموظفين', 'Employee performance'), op('returns', 'المرتجعات', 'Returns'),
  ] },
  { key: 'cost', ar: 'تكلفة وربح المبيعات', en: 'Sales Cost & Profit', descriptionAr: 'تكلفة المباع وربحه، وتكلفة المكونات والمطابقة', descriptionEn: 'Sold-item costs, profit, component costs and reconciliation', views: [
    op('sales_costs', 'تكلفة المباع وربحه', 'Sold-item costs & profit'), op('profit', 'ملخص الربح المحاسبي', 'Accounting profit summary'), op('recipe_costs', 'تكلفة مكونات المنتجات الحالية', 'Current product component costs'),
    op('raw_material_current_cost', 'أسعار الخامات الحالية', 'Current raw material prices'), op('sales_component_reconciliation', 'مطابقة استهلاك المبيعات', 'Sales consumption reconciliation'), op('raw_material_financial', 'ملخص تكلفة الخامات', 'Material cost summary'),
  ] },
  { key: 'purchases', ar: 'المشتريات', en: 'Purchases', descriptionAr: 'فواتير المشتريات والموردون ومرتجعات الشراء', descriptionEn: 'Purchase invoices, suppliers and purchase returns', views: [op('purchases', 'فواتير المشتريات', 'Purchase invoices')] },
  { key: 'expenses', ar: 'المصروفات', en: 'Expenses', descriptionAr: 'التفاصيل والتصنيفات وملخص الفترة', descriptionEn: 'Details, categories and period totals', views: [op('expenses', 'تفاصيل المصروفات', 'Expense details')] },
  { key: 'inventory', ar: 'المخزون', en: 'Inventory', descriptionAr: 'الأرصدة الحالية والتاريخية والحركة والنواقص والهالك', descriptionEn: 'Current & historical balances, movements, shortages and waste', views: [
    op('inventory', 'الأرصدة الحالية', 'Current balances'), op('inventory_as_of', 'أرصدة الخامات بتاريخ', 'Material balances as of date'),
    op('raw_material_consumption', 'حركة واستهلاك الخامات', 'Material movements & consumption'), financial('inventory_movement', 'كشف حركة صنف', 'Item statement'),
    op('low_stock', 'النواقص', 'Shortages'), op('production_waste', 'الهالك', 'Waste'), op('component_consumption', 'استهلاك المكونات', 'Component consumption'),
  ] },
  { key: 'collections', ar: 'التحصيل والأرصدة', en: 'Collections & Balances', descriptionAr: 'طرق الدفع والخزائن والبنوك والعملاء والموردون', descriptionEn: 'Payment methods, treasuries, banks, customers and suppliers', views: [
    op('sales_by_payment', 'طرق الدفع', 'Payment methods'), op('daily_closing_range', 'ملخص التحصيل اليومي', 'Daily collections'),
    financial('treasury_statement', 'كشف الخزنة أو البنك', 'Treasury / bank statement'), financial('party_statement', 'كشف عميل أو مورد', 'Customer / supplier statement'),
    financial('ar_aging', 'أرصدة العملاء بتاريخ', 'Customer balances as of date'), financial('ap_aging', 'أرصدة الموردين بتاريخ', 'Supplier balances as of date'),
    financial('aging_summary', 'ملخص الذمم بتاريخ', 'Receivables & payables as of date'), op('financial_reconciliation', 'مطابقة التحصيل', 'Collection reconciliation'),
  ] },
  { key: 'accounting', ar: 'التقارير المحاسبية', en: 'Accounting Reports', descriptionAr: 'القوائم المالية وميزان المراجعة ودفتر الأستاذ', descriptionEn: 'Financial statements, trial balance and general ledger', views: [
    financial('income', 'قائمة الدخل', 'Income statement'), financial('balance_sheet', 'الميزانية بتاريخ', 'Balance sheet as of date'),
    financial('trial_balance', 'ميزان المراجعة بتاريخ', 'Trial balance as of date'), financial('ledger', 'دفتر الأستاذ', 'General ledger'), financial('cash_flow', 'التدفقات النقدية', 'Cash flow'),
  ] },
];

// Legacy URLs resolve to a consolidated view without querying both reports.
const aliases: Partial<Record<ReportType, string>> = {
  detailed_invoices: 'sales', sales_by_employee: 'cashier_performance',
  top_consumed_products: 'sales_by_product', top_consumed_components: 'component_consumption',
};
export function workspaceViewKey(type: ReportType): string { return aliases[type] || type; }
export function permittedBasicReports(can: (permission: string) => boolean): BasicReport[] {
  return BASIC_REPORTS.map(report => ({ ...report, views: report.views.filter(view => view.permissions.every(can)) })).filter(report => report.views.length > 0);
}
