import type { ReportType } from './reportFilters';

export interface ReportExcelProfile {
  columns: string[];
  columnWidths: Record<string, number>;
  integerColumns: string[];
  sourceNote: string;
}

const pick = (lang: 'ar' | 'en', ar: string, en: string) => lang === 'ar' ? ar : en;

export function getReportExcelProfile(reportType: ReportType, lang: 'ar' | 'en'): ReportExcelProfile {
  const branch = pick(lang, 'الفرع', 'Branch');
  const profiles: Record<ReportType, Omit<ReportExcelProfile, 'sourceNote'>> = {
    sales: {
      columns: [branch, pick(lang, 'الفاتورة', 'Invoice'), pick(lang, 'التاريخ', 'Date'), pick(lang, 'العميل', 'Customer'), pick(lang, 'الإجمالي الأصلي', 'Original Total'), pick(lang, 'المرتجع', 'Refunded'), pick(lang, 'صافي المبيعات', 'Net Sales')],
      columnWidths: { [branch]: 24, [pick(lang, 'الفاتورة', 'Invoice')]: 18, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'العميل', 'Customer')]: 24 },
      integerColumns: [],
    },
    purchases: {
      columns: [branch, pick(lang, 'الفاتورة', 'Invoice'), pick(lang, 'التاريخ', 'Date'), pick(lang, 'المورد', 'Supplier'), pick(lang, 'الإجمالي الأصلي', 'Original Total'), pick(lang, 'مرتجع المشتريات', 'Returned'), pick(lang, 'صافي المشتريات', 'Net Purchases')],
      columnWidths: { [branch]: 24, [pick(lang, 'الفاتورة', 'Invoice')]: 18, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'المورد', 'Supplier')]: 24 },
      integerColumns: [],
    },
    expenses: {
      columns: [branch, pick(lang, 'التاريخ', 'Date'), pick(lang, 'الفئة', 'Category'), pick(lang, 'الوصف', 'Description'), pick(lang, 'المبلغ', 'Amount')],
      columnWidths: { [branch]: 24, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'الفئة', 'Category')]: 22, [pick(lang, 'الوصف', 'Description')]: 36 },
      integerColumns: [],
    },
    profit: {
      columns: [branch, pick(lang, 'الفترة', 'Period'), pick(lang, 'صافي الإيراد', 'Net Revenue'), pick(lang, 'تكلفة البضاعة المباعة', 'COGS'), pick(lang, 'مجمل الربح', 'Gross Profit'), pick(lang, 'المصروفات', 'Expenses'), pick(lang, 'صافي الربح', 'Net Profit')],
      columnWidths: { [branch]: 24, [pick(lang, 'الفترة', 'Period')]: 24 },
      integerColumns: [],
    },
    inventory: {
      columns: [branch, pick(lang, 'المستودع', 'Warehouse'), pick(lang, 'الصنف', 'Item'), pick(lang, 'النوع', 'Type'), pick(lang, 'الكود', 'Code'), pick(lang, 'الكمية', 'Quantity')],
      columnWidths: { [branch]: 24, [pick(lang, 'المستودع', 'Warehouse')]: 22, [pick(lang, 'الصنف', 'Item')]: 28, [pick(lang, 'الكود', 'Code')]: 18 },
      integerColumns: [],
    },
    sales_by_payment: {
      columns: [branch, pick(lang, 'طريقة الدفع', 'Payment Method'), pick(lang, 'صافي المبيعات', 'Net Sales'), pick(lang, 'عدد الفواتير', 'Invoices'), pick(lang, 'مصدر البيانات', 'Data Source')],
      columnWidths: { [branch]: 24, [pick(lang, 'طريقة الدفع', 'Payment Method')]: 24, [pick(lang, 'مصدر البيانات', 'Data Source')]: 28 },
      integerColumns: [pick(lang, 'عدد الفواتير', 'Invoices')],
    },
    sales_by_employee: {
      columns: [branch, pick(lang, 'الموظف', 'Employee'), pick(lang, 'صافي المبيعات', 'Net Sales'), pick(lang, 'الفواتير', 'Invoices'), pick(lang, 'متوسط الفاتورة', 'Avg Invoice')],
      columnWidths: { [branch]: 24, [pick(lang, 'الموظف', 'Employee')]: 26 },
      integerColumns: [pick(lang, 'الفواتير', 'Invoices')],
    },
    sales_by_product: {
      columns: [branch, pick(lang, 'المنتج', 'Product'), pick(lang, 'صافي الكمية', 'Net Quantity'), pick(lang, 'صافي الإيراد', 'Net Revenue')],
      columnWidths: { [branch]: 24, [pick(lang, 'المنتج', 'Product')]: 30 },
      integerColumns: [],
    },
    detailed_invoices: {
      columns: [branch, pick(lang, 'رقم الفاتورة', 'Invoice'), pick(lang, 'التاريخ', 'Date'), pick(lang, 'العميل', 'Customer'), pick(lang, 'أمين الصندوق', 'Cashier'), pick(lang, 'طريقة الدفع', 'Payment'), pick(lang, 'الإجمالي الأصلي', 'Original Total'), pick(lang, 'المرتجع', 'Refunded'), pick(lang, 'صافي الفاتورة', 'Net Total'), pick(lang, 'صافي المدفوع', 'Net Paid'), pick(lang, 'الحالة', 'Status')],
      columnWidths: { [branch]: 24, [pick(lang, 'رقم الفاتورة', 'Invoice')]: 18, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'العميل', 'Customer')]: 22, [pick(lang, 'أمين الصندوق', 'Cashier')]: 22 },
      integerColumns: [],
    },
    component_consumption: {
      columns: [branch, pick(lang, 'المكوّن', 'Component'), pick(lang, 'الكمية المستهلكة', 'Consumed Qty'), pick(lang, 'تكلفة الاستهلاك', 'Consumption Cost'), pick(lang, 'عدد الحركات', 'Movements')],
      columnWidths: { [branch]: 24, [pick(lang, 'المكوّن', 'Component')]: 30 },
      integerColumns: [pick(lang, 'عدد الحركات', 'Movements')],
    },
    recipe_costs: {
      columns: [branch, pick(lang, 'المنتج', 'Product'), pick(lang, 'تكلفة الوصفة', 'Recipe Cost'), pick(lang, 'سعر البيع', 'Sale Price'), pick(lang, 'الهامش', 'Margin')],
      columnWidths: { [branch]: 24, [pick(lang, 'المنتج', 'Product')]: 30 },
      integerColumns: [],
    },
    top_consumed_components: {
      columns: [branch, pick(lang, 'المكوّن', 'Component'), pick(lang, 'الكمية المستهلكة', 'Consumed Qty')],
      columnWidths: { [branch]: 24, [pick(lang, 'المكوّن', 'Component')]: 32 },
      integerColumns: [],
    },
    top_consumed_products: {
      columns: [branch, pick(lang, 'المنتج', 'Product'), pick(lang, 'صافي الكمية', 'Net Quantity')],
      columnWidths: { [branch]: 24, [pick(lang, 'المنتج', 'Product')]: 32 },
      integerColumns: [],
    },
    low_stock: {
      columns: [branch, pick(lang, 'الصنف', 'Item'), pick(lang, 'النوع', 'Type'), pick(lang, 'الكود', 'Code'), pick(lang, 'الكمية', 'Quantity'), pick(lang, 'الحد الأدنى', 'Low Stock Threshold')],
      columnWidths: { [branch]: 24, [pick(lang, 'الصنف', 'Item')]: 30, [pick(lang, 'الكود', 'Code')]: 18 },
      integerColumns: [],
    },
    cashier_performance: {
      columns: [branch, pick(lang, 'الموظف', 'Employee'), pick(lang, 'الفواتير', 'Invoices'), pick(lang, 'صافي المبيعات', 'Net Sales'), pick(lang, 'متوسط الفاتورة', 'Avg Order'), pick(lang, 'المرتجعات', 'Refunds'), pick(lang, 'نسبة المرتجعات', 'Refund Rate')],
      columnWidths: { [branch]: 24, [pick(lang, 'الموظف', 'Employee')]: 26 },
      integerColumns: [pick(lang, 'الفواتير', 'Invoices'), pick(lang, 'المرتجعات', 'Refunds')],
    },
    returns: {
      columns: [branch, pick(lang, 'رقم الفاتورة', 'Invoice'), pick(lang, 'التاريخ', 'Date'), pick(lang, 'العميل', 'Customer'), pick(lang, 'أمين الصندوق', 'Cashier'), pick(lang, 'المبلغ المرتجع', 'Refunded Amount'), pick(lang, 'الحالة', 'Status')],
      columnWidths: { [branch]: 24, [pick(lang, 'رقم الفاتورة', 'Invoice')]: 18, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'العميل', 'Customer')]: 22, [pick(lang, 'أمين الصندوق', 'Cashier')]: 22 },
      integerColumns: [],
    },
    production_waste: {
      columns: [branch, pick(lang, 'المنتج', 'Product'), pick(lang, 'التاريخ', 'Date'), pick(lang, 'الكمية', 'Quantity'), pick(lang, 'تكلفة الوحدة', 'Unit Cost'), pick(lang, 'التكلفة الإجمالية', 'Total Cost'), pick(lang, 'السبب', 'Reason'), pick(lang, 'المستودع', 'Warehouse')],
      columnWidths: { [branch]: 24, [pick(lang, 'المنتج', 'Product')]: 28, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'السبب', 'Reason')]: 32, [pick(lang, 'المستودع', 'Warehouse')]: 22 },
      integerColumns: [],
    },
    daily_closing_range: {
      columns: [
        branch, pick(lang, 'اليوم', 'Business Date'), pick(lang, 'إجمالي المبيعات', 'Gross Sales'),
        pick(lang, 'الخصومات', 'Discounts'), pick(lang, 'الضرائب', 'Taxes'), pick(lang, 'المرتجعات', 'Returns'),
        pick(lang, 'صافي المبيعات', 'Net Sales'), pick(lang, 'كاش', 'Cash'), pick(lang, 'كارت', 'Card'),
        pick(lang, 'تحويل', 'Transfer'), pick(lang, 'آجل', 'Credit'),
        pick(lang, 'بنك تاريخي غير مصنف', 'Legacy Bank'), pick(lang, 'طرق دفع أخرى', 'Other Payment'),
        pick(lang, 'المصروفات', 'Expenses'), pick(lang, 'مشتريات كاش', 'Cash Purchases'),
        pick(lang, 'صافي كاش بعد المنصرف', 'Cash After Outflows'),
        pick(lang, 'عدد الفواتير', 'Invoices'), pick(lang, 'عدد الشفتات', 'Shifts'),
        pick(lang, 'حالة اليوم', 'Day Status'),
      ],
      columnWidths: {
        [branch]: 24, [pick(lang, 'اليوم', 'Business Date')]: 16,
        [pick(lang, 'حالة اليوم', 'Day Status')]: 14,
      },
      integerColumns: [pick(lang, 'عدد الفواتير', 'Invoices'), pick(lang, 'عدد الشفتات', 'Shifts')],
    },
    raw_material_consumption: {
      columns: [
        branch, pick(lang, 'الخامة', 'Raw Material'), pick(lang, 'الكود', 'Code'), pick(lang, 'الوحدة', 'Unit'),
        pick(lang, 'رصيد أول المدة', 'Opening Qty'), pick(lang, 'المشتريات كمية', 'Purchase Qty'),
        pick(lang, 'تحويلات داخلة', 'Transfer In'), pick(lang, 'تحويلات خارجة', 'Transfer Out'),
        pick(lang, 'استهلاك المبيعات', 'Sales Consumption Qty'), pick(lang, 'قيمة الاستهلاك', 'Consumption Value'),
        pick(lang, 'الهالك', 'Waste Qty'), pick(lang, 'تسويات وحركات أخرى', 'Other Net Qty'),
        pick(lang, 'رصيد آخر المدة', 'Closing Qty'), pick(lang, 'قيمة آخر المدة', 'Closing Value'),
      ],
      columnWidths: { [branch]: 24, [pick(lang, 'الخامة', 'Raw Material')]: 30, [pick(lang, 'الكود', 'Code')]: 18, [pick(lang, 'الوحدة', 'Unit')]: 14 },
      integerColumns: [],
    },
    raw_material_current_cost: {
      columns: [
        branch, pick(lang, 'الخامة', 'Raw Material'), pick(lang, 'الكود', 'Code'), pick(lang, 'الوحدة', 'Unit'),
        pick(lang, 'الكمية الحالية', 'Current Qty'), pick(lang, 'تكلفة الوحدة الحالية FIFO', 'Current FIFO Unit Cost'),
        pick(lang, 'قيمة المخزون الحالية', 'Current Inventory Value'), pick(lang, 'آخر تكلفة معتمدة', 'Latest Authoritative Cost'),
        pick(lang, 'مصدر السعر', 'Price Source'), pick(lang, 'طبقات FIFO المفتوحة', 'Open FIFO Batches'),
      ],
      columnWidths: { [branch]: 24, [pick(lang, 'الخامة', 'Raw Material')]: 30, [pick(lang, 'مصدر السعر', 'Price Source')]: 20 },
      integerColumns: [pick(lang, 'طبقات FIFO المفتوحة', 'Open FIFO Batches')],
    },
    raw_material_financial: {
      columns: [
        branch, pick(lang, 'الخامة', 'Raw Material'), pick(lang, 'الوحدة', 'Unit'),
        pick(lang, 'كمية أول المدة', 'Opening Qty'), pick(lang, 'قيمة أول المدة', 'Opening Value'),
        pick(lang, 'كمية المشتريات', 'Purchase Qty'), pick(lang, 'قيمة المشتريات', 'Purchase Value'),
        pick(lang, 'صافي المبيعات', 'Net Sales'), pick(lang, 'كمية استهلاك المبيعات', 'Sales Consumption Qty'),
        pick(lang, 'قيمة استهلاك المبيعات', 'Sales Consumption Value'), pick(lang, 'كمية آخر المدة', 'Closing Qty'),
        pick(lang, 'قيمة آخر المدة', 'Closing Value'), pick(lang, 'مجمل الربح', 'Gross Profit'),
        pick(lang, 'نسبة تكلفة الخامات %', 'Food Cost %'),
      ],
      columnWidths: { [branch]: 24, [pick(lang, 'الخامة', 'Raw Material')]: 30, [pick(lang, 'الوحدة', 'Unit')]: 14 },
      integerColumns: [],
    },
    financial_reconciliation: {
      columns: [branch, pick(lang, 'التاريخ', 'Date'), pick(lang, 'رقم الفاتورة', 'Invoice'), pick(lang, 'صافي الفاتورة', 'Net Sale'), pick(lang, 'كاش', 'Cash'), pick(lang, 'كارت', 'Card'), pick(lang, 'تحويل', 'Transfer'), pick(lang, 'بنك تاريخي غير مصنف', 'Legacy Bank'), pick(lang, 'آجل — مستحق من العميل', 'Credit — Customer outstanding'), pick(lang, 'حركة الخزنة', 'Cash GL'), pick(lang, 'حركة البنك', 'Bank GL'), pick(lang, 'فرق الخزنة', 'Cash Difference'), pick(lang, 'فرق البنك', 'Bank Difference'), pick(lang, 'المطابقة', 'Reconciliation')],
      columnWidths: { [branch]: 24, [pick(lang, 'التاريخ', 'Date')]: 18, [pick(lang, 'رقم الفاتورة', 'Invoice')]: 20, [pick(lang, 'المطابقة', 'Reconciliation')]: 24 },
      integerColumns: [],
    },
  };

  const profile = profiles[reportType];
  const sourceNote = reportType === 'financial_reconciliation'
    ? pick(lang, 'تفاصيل الدفع + قيود الخزنة والبنك، مع إظهار أي فرق دون إخفائه.', 'Payment detail + treasury/bank journal entries; mismatches are shown explicitly.')
    : reportType === 'sales_by_payment'
      ? pick(lang, 'تفاصيل sale_payments، والقيود المحاسبية فقط للحالات التاريخية الناقصة، والآجل يظهر كذمم لا كبنك.', 'sale_payments details, journal fallback only for incomplete legacy splits, and credit shown as receivable rather than bank.')
      : pick(lang, 'نفس مصدر البيانات المستخدم داخل التقرير؛ لا يعاد حساب الإجمالي بطريقة مختلفة أثناء التصدير.', 'Same data source used on-screen; export does not recompute totals differently.');

  return { ...profile, sourceNote };
}
