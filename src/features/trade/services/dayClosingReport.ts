import { supabase } from '@/api';
import { escapeHtml, formatCurrency, formatDateTime } from '@/lib/format';
import type { Language } from '@/lib/types';

export interface DayClosingReport {
  branchId: string;
  branchName: string;
  businessDate: string;
  dailyCloseStatus: 'open' | 'closed';
  snapshot: boolean;
  historicalReconciled: boolean;
  snapshotCashExpenses: number;
  snapshotCashAfterOutflows: number;
  reconciliationCashExpenseDelta: number;
  reconciliationCashAfterDelta: number;
  businessDayMode: 'fixed_time' | 'shift_span';
  windowStart: string;
  windowEnd: string;
  grossSales: number;
  discounts: number;
  taxes: number;
  returns: number;
  netSales: number;
  expenses: number;
  cashPurchases: number;
  netAfterExpenses: number;
  netAfterExpensesAndCashPurchases: number;
  cashSales: number;
  cashExpenses: number;
  cashAfterOutflows: number;
  invoiceCount: number;
  shiftCount: number;
  paymentMethods: Array<{ method: string; invoiceCount: number; salesTotal: number }>;
  shifts: Array<{
    shiftId: string; cashierId: string; cashierName: string; openedAt: string; closedAt: string | null;
    openingAmount: number; expectedAmount: number; actualAmount: number; difference: number; status: string;
  }>;
  salesDetails: Array<{
    saleId: string; invoiceNumber: string; userId: string; userName: string; subtotal: number; discountAmount: number;
    taxAmount: number; total: number; paidAmount: number; refundedAmount: number; paymentMethod: string; orderType: string;
    status: string; createdAt: string;
  }>;
  expenseDetails: Array<{
    expenseId: string; category: string; description: string; amount: number; paymentMethod: string; expenseDate: string;
    notes: string | null; createdAt: string; createdBy: string; createdByName: string; shiftId: string;
  }>;
  cashPurchaseDetails: Array<{
    purchaseId: string; invoiceNumber: string; supplierId: string; supplierName: string; buyerId: string; buyerName: string;
    subtotal: number; discountAmount: number; taxAmount: number; total: number; paidAmount: number; returnedAmount: number;
    cashOutflow: number; paymentMethod: string; status: string; createdAt: string;
  }>;
  users: Array<{
    userId: string; displayName: string; invoiceCount: number; salesTotal: number; discounts: number; returns: number;
    expenses: number; cashPurchases: number;
  }>;
}

const n = (v: unknown) => Number(v || 0);
const s = (v: unknown) => String(v || '');

export async function fetchDayClosingReportServer(branchId: string, businessDate: string): Promise<DayClosingReport> {
  const { data, error } = await supabase.rpc('get_day_closing_report', { p_branch_id: branchId, p_day: businessDate });
  if (error) throw new Error(error.message);
  const raw = data as Record<string, unknown> | null;
  if (!raw?.success) throw new Error(String(raw?.detail || raw?.error || 'Could not load day closing report'));

  return {
    branchId: s(raw.branch_id),
    branchName: s(raw.branch_name),
    businessDate: s(raw.business_date || businessDate),
    dailyCloseStatus: raw.daily_close_status === 'closed' ? 'closed' : 'open',
    snapshot: Boolean(raw.snapshot),
    historicalReconciled: Boolean(raw.historical_reconciled),
    snapshotCashExpenses: n(raw.snapshot_cash_expenses),
    snapshotCashAfterOutflows: n(raw.snapshot_cash_after_outflows),
    reconciliationCashExpenseDelta: n(raw.reconciliation_cash_expense_delta),
    reconciliationCashAfterDelta: n(raw.reconciliation_cash_after_delta),
    businessDayMode: raw.business_day_mode === 'shift_span' ? 'shift_span' : 'fixed_time',
    windowStart: s(raw.window_start),
    windowEnd: s(raw.window_end),
    grossSales: n(raw.gross_sales),
    discounts: n(raw.discounts),
    taxes: n(raw.taxes),
    returns: n(raw.returns),
    netSales: n(raw.net_sales),
    expenses: n(raw.expenses),
    cashPurchases: n(raw.cash_purchases),
    netAfterExpenses: n(raw.net_after_expenses),
    netAfterExpensesAndCashPurchases: n(raw.net_after_expenses_and_cash_purchases),
    cashSales: n(raw.cash_sales),
    cashExpenses: n(raw.cash_expenses),
    cashAfterOutflows: n(raw.cash_after_outflows),
    invoiceCount: n(raw.invoice_count),
    shiftCount: n(raw.shift_count),
    paymentMethods: Array.isArray(raw.payment_methods) ? raw.payment_methods.map((x) => {
      const r = x as Record<string, unknown>;
      return { method: s(r.method), invoiceCount: n(r.invoice_count), salesTotal: n(r.sales_total) };
    }) : [],
    shifts: Array.isArray(raw.shifts) ? raw.shifts.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        shiftId: s(r.shift_id), cashierId: s(r.cashier_id), cashierName: s(r.cashier_name), openedAt: s(r.opened_at),
        closedAt: r.closed_at ? s(r.closed_at) : null, openingAmount: n(r.opening_amount), expectedAmount: n(r.expected_amount),
        actualAmount: n(r.actual_amount), difference: n(r.difference), status: s(r.status),
      };
    }) : [],
    salesDetails: Array.isArray(raw.sales_details) ? raw.sales_details.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        saleId: s(r.sale_id), invoiceNumber: s(r.invoice_number), userId: s(r.user_id), userName: s(r.user_name),
        subtotal: n(r.subtotal), discountAmount: n(r.discount_amount), taxAmount: n(r.tax_amount), total: n(r.total),
        paidAmount: n(r.paid_amount), refundedAmount: n(r.refunded_amount), paymentMethod: s(r.payment_method),
        orderType: s(r.order_type), status: s(r.status), createdAt: s(r.created_at),
      };
    }) : [],
    expenseDetails: Array.isArray(raw.expense_details) ? raw.expense_details.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        expenseId: s(r.expense_id), category: s(r.category), description: s(r.description), amount: n(r.amount),
        paymentMethod: s(r.payment_method), expenseDate: s(r.expense_date), notes: r.notes ? s(r.notes) : null,
        createdAt: s(r.created_at), createdBy: s(r.created_by), createdByName: s(r.created_by_name), shiftId: s(r.shift_id),
      };
    }) : [],
    cashPurchaseDetails: Array.isArray(raw.cash_purchase_details) ? raw.cash_purchase_details.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        purchaseId: s(r.purchase_id), invoiceNumber: s(r.invoice_number), supplierId: s(r.supplier_id), supplierName: s(r.supplier_name),
        buyerId: s(r.buyer_id), buyerName: s(r.buyer_name), subtotal: n(r.subtotal), discountAmount: n(r.discount_amount),
        taxAmount: n(r.tax_amount), total: n(r.total), paidAmount: n(r.paid_amount), returnedAmount: n(r.returned_amount),
        cashOutflow: n(r.cash_outflow), paymentMethod: s(r.payment_method), status: s(r.status), createdAt: s(r.created_at),
      };
    }) : [],
    users: Array.isArray(raw.users) ? raw.users.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        userId: s(r.user_id), displayName: s(r.display_name), invoiceCount: n(r.invoice_count), salesTotal: n(r.sales_total),
        discounts: n(r.discounts), returns: n(r.returns), expenses: n(r.expenses), cashPurchases: n(r.cash_purchases),
      };
    }) : [],
  };
}

export function buildA4DayClosingReportHtml(report: DayClosingReport, currency = 'EGP', lang: Language = 'ar'): string {
  const isAr = lang === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const money = (v: number) => formatCurrency(v, currency, lang);
  return `<!doctype html><html dir="${dir}" lang="${isAr ? 'ar' : 'en'}"><head><meta charset="utf-8">
<title>${isAr ? 'تقرير إغلاق اليوم' : 'Day Closing Report'}</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Cairo",sans-serif;margin:0;padding:20px;color:#111827;background:#fff;font-size:12px}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:5px}
.meta{display:flex;justify-content:space-between;gap:16px;margin-top:8px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}
.card{border:1px solid #d1d5db;border-radius:8px;padding:10px}.label{font-size:10px;color:#6b7280}.value{font-size:15px;font-weight:800;margin-top:3px}
table{width:100%;border-collapse:collapse;margin:6px 0 16px}th,td{border:1px solid #d1d5db;padding:6px;text-align:${isAr ? 'right' : 'left'};vertical-align:top}th{background:#f3f4f6}
.num{text-align:${isAr ? 'left' : 'right'};white-space:nowrap}.negative{color:#b91c1c}.strong{font-weight:800}
@media print{@page{size:A4;margin:8mm}body{padding:0}}
</style></head><body onload="window.print()">
<h1>${escapeHtml(report.branchName)} — ${isAr ? 'إغلاق اليوم' : 'Day Close'}</h1>
<div class="meta"><div>${isAr ? 'تاريخ العمل' : 'Business date'}: <b>${escapeHtml(report.businessDate)}</b></div><div>${report.snapshot ? (isAr ? 'نسخة إغلاق ثابتة' : 'Immutable closing snapshot') : (isAr ? 'معاينة مباشرة' : 'Live preview')}</div></div>
<div class="meta"><div><b>${isAr ? 'بداية اليوم:' : 'Day start:'}</b> ${report.windowStart ? formatDateTime(report.windowStart, lang) : '-'}</div><div><b>${isAr ? 'نهاية اليوم:' : 'Day end:'}</b> ${report.windowEnd ? formatDateTime(report.windowEnd, lang) : '-'}</div></div>
<div class="meta"><div>${isAr ? 'طريقة تحديد اليوم:' : 'Boundary mode:'} <b>${report.businessDayMode === 'shift_span' ? (isAr ? 'أول شفت ← آخر شفت' : 'First shift → last shift') : (isAr ? 'وقت ثابت' : 'Fixed time')}</b></div></div>
${report.historicalReconciled ? `<div style="margin-top:10px;padding:10px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb">
<b>${isAr ? 'تمت مصالحة هذا الإغلاق التاريخي مع حركة الخزنة الفعلية.' : 'This historical close was reconciled to actual treasury movements.'}</b>
<div>${isAr ? 'مصروفات الكاش المحفوظة سابقًا' : 'Stored cash expenses'}: ${money(report.snapshotCashExpenses)} → <b>${money(report.cashExpenses)}</b></div>
<div>${isAr ? 'الكاش بعد الخارج المحفوظ سابقًا' : 'Stored cash after outflows'}: ${money(report.snapshotCashAfterOutflows)} → <b>${money(report.cashAfterOutflows)}</b></div>
</div>` : ''}
<div class="grid">
<div class="card"><div class="label">${isAr ? 'صافي المبيعات' : 'Net sales'}</div><div class="value">${money(report.netSales)}</div></div>
<div class="card"><div class="label">${isAr ? 'المصروفات' : 'Expenses'}</div><div class="value negative">-${money(report.expenses)}</div></div>
<div class="card"><div class="label">${isAr ? 'مشتريات الكاش' : 'Cash purchases'}</div><div class="value negative">-${money(report.cashPurchases)}</div></div>
<div class="card"><div class="label">${isAr ? 'الصافي بعد كل الخارج' : 'Net after outflows'}</div><div class="value">${money(report.netAfterExpensesAndCashPurchases)}</div></div>
</div>
<h2>${isAr ? 'ملخص اليوم بالكامل' : 'Full day summary'}</h2>
<table><tbody>
<tr><td>${isAr ? 'إجمالي المبيعات' : 'Gross sales'}</td><td class="num">${money(report.grossSales)}</td></tr>
<tr><td>${isAr ? 'الخصومات' : 'Discounts'}</td><td class="num negative">-${money(report.discounts)}</td></tr>
<tr><td>${isAr ? 'المرتجعات' : 'Returns'}</td><td class="num negative">-${money(report.returns)}</td></tr>
<tr><td>${isAr ? 'الضرائب' : 'Taxes'}</td><td class="num">${money(report.taxes)}</td></tr>
<tr><td>${isAr ? 'صافي المبيعات' : 'Net sales'}</td><td class="num strong">${money(report.netSales)}</td></tr>
<tr><td>${isAr ? 'إجمالي المصروفات' : 'Expenses'}</td><td class="num negative">-${money(report.expenses)}</td></tr>
<tr><td>${isAr ? 'مشتريات الكاش' : 'Cash purchases'}</td><td class="num negative">-${money(report.cashPurchases)}</td></tr>
<tr><td>${isAr ? 'الصافي بعد المصروفات والمشتريات الكاش' : 'Net after expenses & cash purchases'}</td><td class="num strong">${money(report.netAfterExpensesAndCashPurchases)}</td></tr>
<tr><td>${isAr ? 'كاش المبيعات' : 'Cash sales'}</td><td class="num">${money(report.cashSales)}</td></tr>
<tr><td>${isAr ? 'مصروفات كاش' : 'Cash expenses'}</td><td class="num negative">-${money(report.cashExpenses)}</td></tr>
<tr><td>${isAr ? 'الكاش بعد الخارج' : 'Cash after outflows'}</td><td class="num strong">${money(report.cashAfterOutflows)}</td></tr>
</tbody></table>

<h2>${isAr ? 'الشفتات' : 'Shifts'}</h2>
<table><thead><tr><th>${isAr ? 'المستخدم' : 'User'}</th><th>${isAr ? 'فتح' : 'Opened'}</th><th>${isAr ? 'إغلاق' : 'Closed'}</th><th class="num">${isAr ? 'المتوقع' : 'Expected'}</th><th class="num">${isAr ? 'الفعلي' : 'Actual'}</th><th class="num">${isAr ? 'الفرق' : 'Difference'}</th></tr></thead>
<tbody>${report.shifts.map(x=>`<tr><td>${escapeHtml(x.cashierName)}</td><td>${formatDateTime(x.openedAt,lang)}</td><td>${x.closedAt?formatDateTime(x.closedAt,lang):'-'}</td><td class="num">${money(x.expectedAmount)}</td><td class="num">${money(x.actualAmount)}</td><td class="num">${money(x.difference)}</td></tr>`).join('')}</tbody></table>

<h2>${isAr ? 'كل مستخدم — التفاصيل' : 'Every user — details'}</h2>
<table><thead><tr><th>${isAr ? 'المستخدم' : 'User'}</th><th class="num">${isAr ? 'الفواتير' : 'Invoices'}</th><th class="num">${isAr ? 'المبيعات' : 'Sales'}</th><th class="num">${isAr ? 'الخصومات' : 'Discounts'}</th><th class="num">${isAr ? 'المرتجعات' : 'Returns'}</th><th class="num">${isAr ? 'المصروفات' : 'Expenses'}</th><th class="num">${isAr ? 'مشتريات كاش' : 'Cash purchases'}</th></tr></thead>
<tbody>${report.users.map(x=>`<tr><td>${escapeHtml(x.displayName)}</td><td class="num">${x.invoiceCount}</td><td class="num">${money(x.salesTotal)}</td><td class="num">${money(x.discounts)}</td><td class="num">${money(x.returns)}</td><td class="num">${money(x.expenses)}</td><td class="num">${money(x.cashPurchases)}</td></tr>`).join('')}</tbody></table>

<h2>${isAr ? 'المصروفات — بدون إخفاء' : 'Expenses — full detail'}</h2>
<table><thead><tr><th>${isAr ? 'التصنيف' : 'Category'}</th><th>${isAr ? 'البيان' : 'Description'}</th><th>${isAr ? 'المستخدم' : 'User'}</th><th>${isAr ? 'الدفع' : 'Payment'}</th><th class="num">${isAr ? 'المبلغ' : 'Amount'}</th></tr></thead>
<tbody>${report.expenseDetails.map(x=>`<tr><td>${escapeHtml(x.category)}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.createdByName)}</td><td>${escapeHtml(x.paymentMethod)}</td><td class="num">${money(x.amount)}</td></tr>`).join('')}</tbody></table>

<h2>${isAr ? 'مشتريات الكاش — بدون إخفاء' : 'Cash purchases — full detail'}</h2>
<table><thead><tr><th>${isAr ? 'الفاتورة' : 'Invoice'}</th><th>${isAr ? 'المورد' : 'Supplier'}</th><th>${isAr ? 'المستخدم' : 'Buyer'}</th><th class="num">${isAr ? 'الإجمالي' : 'Total'}</th><th class="num">${isAr ? 'المدفوع' : 'Paid'}</th><th class="num">${isAr ? 'المرتجع' : 'Returned'}</th><th class="num">${isAr ? 'صافي الخارج' : 'Cash outflow'}</th></tr></thead>
<tbody>${report.cashPurchaseDetails.map(x=>`<tr><td>${escapeHtml(x.invoiceNumber)}</td><td>${escapeHtml(x.supplierName)}</td><td>${escapeHtml(x.buyerName)}</td><td class="num">${money(x.total)}</td><td class="num">${money(x.paidAmount)}</td><td class="num">${money(x.returnedAmount)}</td><td class="num strong">${money(x.cashOutflow)}</td></tr>`).join('')}</tbody></table>

<h2>${isAr ? 'المبيعات — كل الفواتير' : 'Sales — every invoice'}</h2>
<table><thead><tr><th>${isAr ? 'الفاتورة' : 'Invoice'}</th><th>${isAr ? 'المستخدم' : 'User'}</th><th>${isAr ? 'الدفع' : 'Payment'}</th><th class="num">${isAr ? 'الإجمالي' : 'Total'}</th><th class="num">${isAr ? 'المرتجع' : 'Refunded'}</th></tr></thead>
<tbody>${report.salesDetails.map(x=>`<tr><td>${escapeHtml(x.invoiceNumber)}</td><td>${escapeHtml(x.userName)}</td><td>${escapeHtml(x.paymentMethod)}</td><td class="num">${money(x.total)}</td><td class="num">${money(x.refundedAmount)}</td></tr>`).join('')}</tbody></table>
</body></html>`;
}
