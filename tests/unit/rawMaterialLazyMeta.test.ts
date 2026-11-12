import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRawMaterialMeta } from '@/features/manufacturing/services/rawMaterialData';
const mocks = vi.hoisted(() => ({ from: vi.fn(), pages: vi.fn(), prices: vi.fn(), stock: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/features/reporting/fetchAllReportRows', () => ({ fetchAllReportRows: mocks.pages }));
vi.mock('@/features/costing/services/rawCurrentPriceData', () => ({ loadRawMaterialDisplayPrices: mocks.prices }));
vi.mock('@/features/inventory/services/rawStockSummaryData', () => ({ loadRawStockSummary: mocks.stock, stockSummaryPrices: () => [] }));
beforeEach(() => {
  mocks.from.mockReset().mockImplementation(table => {
    const query = { table, select: vi.fn(), order: vi.fn(), eq: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    query.select.mockReturnValue(query); query.order.mockReturnValue(query); query.eq.mockReturnValue(query);
    return query;
  });
  mocks.pages.mockReset().mockResolvedValue([]); mocks.prices.mockReset().mockResolvedValue([]);
  mocks.stock.mockReset().mockResolvedValue([]);
});
describe('raw material tab read budgets', () => {
  it('never executes stock or batch reads while displaying material prices', async () => {
    await loadRawMaterialMeta('a', 'materials');
    expect(mocks.pages).not.toHaveBeenCalled();
    expect(mocks.prices).toHaveBeenCalledExactlyOnceWith('a');
  });
  it.each(['stock', 'batches'] as const)('loads only the requested%s rows within its branch', async tab => {
    await loadRawMaterialMeta('b', tab);
    if (tab === 'batches') {
      expect(mocks.pages).toHaveBeenCalledOnce();
      const query = mocks.pages.mock.calls[0][0];
      expect(query.table).toBe('raw_material_batches');
      expect(query.eq).toHaveBeenCalledWith('branch_id', 'b');
      expect(mocks.stock).not.toHaveBeenCalled();
    } else {
      expect(mocks.pages).not.toHaveBeenCalled();
      expect(mocks.stock).toHaveBeenCalledExactlyOnceWith('b');
    }
    expect(mocks.prices).not.toHaveBeenCalled();
  });
});
