import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ supabase: {} }));
vi.mock('@/features/costing/services/rawCurrentPriceData', () => ({}));
import { buildThermalZReportText, buildThermalZReportHtml, buildA4ZReportHtml, type ShiftClosingSummary } from '@/features/trade/services/shiftClosingReport';

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

describe('compact financial thermal shift closing', () => {
  it.each(['ar','en'] as const)('keeps financial totals and captain invoice sales without composition (%s)',lang=>{
    const input={...summary,userReports:[{userId:'captain',displayName:'Captain A',salesTotal:300,invoiceCount:2,discounts:0,returns:0,expenses:0,netContribution:300}]};
    const before=structuredClone(input);
    for(const output of [buildThermalZReportText(input,'EGP',lang),buildThermalZReportHtml(input,'EGP',lang)]) {
      expect(output).toContain('Captain A');expect(output).toContain('300');expect(output).toContain('245');expect(output).toContain('-5');
      expect(output).not.toContain('Burger');expect(output).not.toContain('دجاج');expect(output).not.toContain('Sauce');
      expect(output).not.toContain('INGREDIENTS');expect(output).not.toContain('PRODUCTS SOLD');
    }
    expect(input).toEqual(before);
    const a4=buildA4ZReportHtml(input,'EGP',lang);expect(a4).toContain('Burger');expect(a4).toContain('دجاج');
  });
  it('does not grow when hundreds of products and materials exist',()=>{
    const large={...summary,productsSold:Array(500).fill(summary.productsSold[0]),ingredientsConsumed:Array(500).fill(summary.ingredientsConsumed[0])};
    expect(buildThermalZReportText(large)).toBe(buildThermalZReportText(summary));
    expect(buildThermalZReportHtml(large).length).toBeLessThan(16000);
  });
});
