import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn(), products: vi.fn(), raw: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { rpc: m.rpc }, costing: { getRawConsumptionCostBreakdown: m.raw } }));
vi.mock('@/features/trade/services/closingProducts', () => ({ loadClosingProducts: m.products }));
import { fetchDayClosingReportServer, buildA4DayClosingReportHtml } from '@/features/trade/services/dayClosingReport';
beforeEach(() => {
  vi.clearAllMocks();
  m.rpc.mockResolvedValue({ data: { success: true, branch_id: 'A', branch_name: 'Smouha', sales_details: [{ sale_id: 'included', status: 'completed' }, { sale_id: 'cancelled', status: 'cancelled' }], net_sales: 77, cash_after_outflows: 35 } });
  m.products.mockResolvedValue([{ productId: 'p', productName: '<Burger>', unitName: 'piece', quantity: 2, total: 40 }]);
});
describe('day closing sold products', () => {
  it('enriches only the server sale cohort, renders escaped products and preserves canonical cash/sales totals', async () => {
    const report = await fetchDayClosingReportServer('A', '2026-10-16');
    expect(m.products).toHaveBeenCalledExactlyOnceWith('A', ['included']);
    expect(report.netSales).toBe(77); expect(report.cashAfterOutflows).toBe(35);
    const html = buildA4DayClosingReportHtml(report, 'EGP', 'en');
    expect(html).toContain('Products sold'); expect(html).toContain('&lt;Burger&gt;');
    expect(html).toContain('2 piece'); expect(html).not.toContain('<Burger>');
  });
});
