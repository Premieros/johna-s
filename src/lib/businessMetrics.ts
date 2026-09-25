export type BusinessLanguage = 'ar' | 'en';

export function purchasePaymentLabel(method: string | null | undefined, lang: BusinessLanguage): string {
  const value = String(method || '').toLowerCase();
  const ar = lang === 'ar';
  if (value === 'cash') return ar ? 'نقدي' : 'Cash';
  if (value === 'credit') return ar ? 'آجل — مستحق للمورد' : 'Credit — Supplier outstanding';
  if (value === 'card') return ar ? 'كارت' : 'Card';
  if (value === 'bank' || value === 'transfer') return ar ? 'تحويل بنكي' : 'Bank transfer';
  return method || '-';
}

export function salesPaymentLabel(method: string | null | undefined, lang: BusinessLanguage): string {
  const value = String(method || '').toLowerCase();
  const ar = lang === 'ar';
  if (value === 'cash') return ar ? 'نقدي' : 'Cash';
  if (value === 'card') return ar ? 'كارت' : 'Card';
  if (value === 'credit') return ar ? 'آجل — مستحق من العميل' : 'Credit — Customer outstanding';
  if (value === 'employee_credit') return ar ? 'آجل موظف — مستحق من الموظف' : 'Employee credit — Employee outstanding';
  if (value === 'instapay' || value === 'transfer') return ar ? 'تحويل / إنستاباي' : 'Transfer / InstaPay';
  if (value === 'split') return ar ? 'دفع مختلط — موزع حسب طرق الدفع' : 'Split payment — allocated by method';
  return method || '-';
}

export function supplierOutstanding(total: number | null | undefined, paid: number | null | undefined, returned: number | null | undefined): number {
  return Math.max(0, Number(total || 0) - Number(paid || 0) - Number(returned || 0));
}

export function customerOutstanding(total: number | null | undefined, paid: number | null | undefined, refunded: number | null | undefined): number {
  return Math.max(0, Number(total || 0) - Number(paid || 0) - Number(refunded || 0));
}

export function businessMetricLabel(key: 'supplier_outstanding' | 'customer_outstanding' | 'bank_balance' | 'cashbox_balance' | 'inventory_value' | 'consumption_value', lang: BusinessLanguage): string {
  const ar = lang === 'ar';
  const labels = {
    supplier_outstanding: ar ? 'مستحق للموردين' : 'Supplier outstanding',
    customer_outstanding: ar ? 'مستحق من العملاء' : 'Customer outstanding',
    bank_balance: ar ? 'رصيد البنك' : 'Bank balance',
    cashbox_balance: ar ? 'رصيد الخزنة' : 'Cashbox balance',
    inventory_value: ar ? 'قيمة رصيد الخامات' : 'Raw-material inventory value',
    consumption_value: ar ? 'قيمة استهلاك الخامات' : 'Raw-material consumption value',
  };
  return labels[key];
}
