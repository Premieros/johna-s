import { describe, expect, it } from 'vitest';
import {
  businessMetricLabel,
  customerOutstanding,
  purchasePaymentLabel,
  salesPaymentLabel,
  supplierOutstanding,
} from '@/lib/businessMetrics';

describe('unified business metrics contract', () => {
  it('uses explicit user-facing credit labels', () => {
    expect(purchasePaymentLabel('credit', 'ar')).toBe('آجل — مستحق للمورد');
    expect(salesPaymentLabel('credit', 'ar')).toBe('آجل — مستحق من العميل');
    expect(salesPaymentLabel('split', 'ar')).toContain('موزع حسب طرق الدفع');
  });

  it('uses the same supplier outstanding formula as AP aging', () => {
    expect(supplierOutstanding(1000, 250, 100)).toBe(650);
    expect(supplierOutstanding(100, 150, 0)).toBe(0);
  });

  it('uses the same customer outstanding formula as operational receivables', () => {
    expect(customerOutstanding(1000, 300, 50)).toBe(650);
    expect(customerOutstanding(100, 120, 0)).toBe(0);
  });

  it('keeps business labels distinct from accounting debit/credit terminology', () => {
    expect(businessMetricLabel('supplier_outstanding', 'ar')).toBe('مستحق للموردين');
    expect(businessMetricLabel('customer_outstanding', 'ar')).toBe('مستحق من العملاء');
    expect(businessMetricLabel('bank_balance', 'ar')).toBe('رصيد البنك');
    expect(businessMetricLabel('inventory_value', 'ar')).toBe('قيمة رصيد الخامات');
  });
});
