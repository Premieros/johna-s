import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRawMaterialMeta } from '@/features/manufacturing/services/rawMaterialData';
const mocks = vi.hoisted(() => ({ from: vi.fn(), pages: vi.fn(), prices: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/features/reporting/fetchAllReportRows', () => ({ fetchAllReportRows: mocks.pages }));
vi.mock('@/features/costing/services/rawCurrentPriceData', () => ({ loadRawMaterialDisplayPrices: mocks.prices }));
beforeEach(() => {
  mocks.from.mockReset().mockImplementation(table => {
    const query = { table, select: vi.fn(), order: vi.fn(), eq: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    query.select.mockReturnValue(query); query.order.mockReturnValue(query); query.eq.mockReturnValue(query);
    return query;
  });
  mocks.pages.mockReset().mockResolvedValue([]); mocks.prices.mockReset().mockResolvedValue([]);
});
describe('raw material tab read budgets', () => {
  it('never executes stock or batch reads while displaying material prices', async () => {
    await loadRawMaterialMeta('a', 'materials');
    expect(mocks.pages).not.toHaveBeenCalled();
    expect(mocks.prices).toHaveBeenCalledExactlyOnceWith('a');
  });
  it.each(['stock', 'batches'] as const)('loads only the requested%s rows within its branch', async tab => {
    await loadRawMaterialMeta('b', tab);
    expect(mocks.pages).toHaveBeenCalledOnce();
    const query = mocks.pages.mock.calls[0][0];
    expect(query.table).toBe(tab === 'stock' ? 'raw_material_inventory' : 'raw_material_batches');
    expect(query.eq).toHaveBeenCalledWith('branch_id', 'b');
    if (tab === 'batches') expect(mocks.prices).not.toHaveBeenCalled();
    else expect(mocks.prices).toHaveBeenCalledWith('b');
  });
});
