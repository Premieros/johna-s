import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
vi.mock('@/features/costing/services/rawCurrentPriceData', () => ({}));
import { buildThermalZReportText, type ShiftClosingSummary } from '@/features/trade/services/shiftClosingReport';

const summary: ShiftClosingSummary = {
  shiftId: 'shift-12345678', branchId: 'cleopatra', branchName: 'كليوباترا', cashierName: 'Cashier',
  openedAt: '2026-10-15T09:00:00Z', closedAt: '2026-10-15T16:27:00Z',
  openingAmount: 0, expectedAmount: 250, actualAmount: 245, difference: -5, notes: null,
  totalInvoices: 2, grossSales: 300, totalDiscounts: 0, returns: 0, voids: 0, expenses: 50,
  drawerExpenses: 50, netRevenue: 250, totalTaxes: 0, netSales: 300, avgTicket: 150,
  orderTypes: [], paymentMethods: [{ method: 'cash', label: 'Cash', count: 2, total: 300 }],
  productsSold: [{ productId: 'burger', productName: 'Burger', quantity: 2, unitName: 'piece', total: 40 }], ingredientsConsumed: [
    { materialId: 'a', materialName: 'دجاج', quantity: 1.2345, unit: 'kg', actualQuantity: 1,
      estimatedQuantity: .2345, actualCost: 120, estimatedCost: 28.14, displayedCost: 148.14 },
    { materialId: 'b', materialName: 'Sauce\nSpecial', quantity: 250, unit: 'g', actualQuantity: 250,
      estimatedQuantity: 0, actualCost: 10, estimatedCost: 0, displayedCost: 10 },
  ],
};

describe('thermal closing materials', () => {
  it.each(['ar', 'en'] as const)('includes authoritative quantities and separate actual/estimated costs (%s)', (lang) => {
    const before = structuredClone(summary);
    const text = buildThermalZReportText(summary, 'EGP', lang);
    expect(text).toContain('Burger | 2 piece | 40 EGP');
    expect(text).toContain('دجاج');
    expect(text).toContain('1.2345 kg');
    expect(text).toContain('250 g');
    expect(text).toContain('Sauce Special');
    expect(text).toContain('120 EGP');
    expect(text).toContain('28.14 EGP');
    expect(text).toContain('158.14 EGP');
    expect(text).toContain(`${lang === 'ar' ? 'المتوقع بالدرج' : 'Expected Cash'}: 250 EGP`);
    expect(text).toContain(`${lang === 'ar' ? 'الفارق' : 'Difference'}: -5 EGP`);
    expect(summary).toEqual(before);
    expect(text).not.toContain('<html');
  });

  it('keeps every material with two source lines rather than four and identical totals', () => {
    const materials = Array.from({ length: 120 }, (_, i) => ({ ...summary.ingredientsConsumed![0], materialId: String(i), materialName: `Material ${i}` }));
    const text = buildThermalZReportText({ ...summary, ingredientsConsumed: materials }, 'EGP', 'en');
    expect(text.split('\r\n').length).toBeLessThan(300);
    for (let i = 0; i < 120; i++) expect(text).toContain(`Material ${i}: 1.2345 kg`);
    expect(text).toContain('120 EGP | Estimated: 28.14 EGP');
    expect(text).toContain('17,776.8 EGP');
  });

  it('labels latest-price consumption and missing prices without presenting a fake zero', () => {
    const row = { ...summary.ingredientsConsumed[0], pricingBasis: 'latest_approved' as const, priceMissing: false, displayedCost: 34 };
    const text = buildThermalZReportText({ ...summary, ingredientsConsumed: [row] }, 'EGP', 'en');
    expect(text).toContain('Latest price cost: 34 EGP');
    expect(text).not.toContain('Estimated:');
    const unknown = buildThermalZReportText({ ...summary, ingredientsConsumed: [{ ...row, priceMissing: true, displayedCost: 0 }] }, 'EGP', 'en');
    expect(unknown).toContain('Latest price cost: Unpriced');
    expect(unknown).toContain('Partial total: some materials are unpriced');
  });

  it('keeps zero consumption distinct from missing report data and never combines unlike quantities', () => {
    const text = buildThermalZReportText({ ...summary, ingredientsConsumed: [] }, 'EGP', 'en');
    expect(text).toContain('Total material cost: 0 EGP');
    expect(text).not.toContain('251.2345');
  });
});
