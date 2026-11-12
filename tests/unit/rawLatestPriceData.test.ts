import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRawLatestPriceRows } from '@/features/costing/services/rawLatestPriceData';
const mocks = vi.hoisted(() => ({ from: vi.fn(), pages: vi.fn(), prices: vi.fn(), eq: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/features/reporting/fetchAllReportRows', () => ({ fetchAllReportRows: mocks.pages }));
vi.mock('@/features/costing/services/rawCurrentPriceData', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/costing/services/rawCurrentPriceData')>(),
  loadRawMaterialDisplayPrices: mocks.prices,
}));
beforeEach(() => {
  const query = { select: vi.fn(), order: vi.fn(), eq: mocks.eq };
  query.select.mockReturnValue(query); query.order.mockReturnValue(query); mocks.eq.mockReset().mockReturnValue(query);
  mocks.from.mockReset().mockReturnValue(query);
  mocks.pages.mockReset().mockResolvedValue([
    { id: 'r', name: 'Egg', code: 'E', branch_id: 'a' },
    { id: 'u', name: 'Unknown', code: null, branch_id: 'a' },
  ]);
  mocks.prices.mockReset().mockResolvedValue([{ raw_material_id: 'r', branch_id: 'a', unit_cost: '3.600000', price_source: 'pricing', priced_at: '2026-10-16', reference_number: 'P' }]);
});
describe('compact latest-price screen data', () => {
  it('uses only branch-scoped material identities and their exact prices', async () => {
    const rows = await loadRawLatestPriceRows('a');
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('raw_materials');
    expect(mocks.eq).toHaveBeenCalledWith('branch_id', 'a');
    expect(mocks.prices).toHaveBeenCalledExactlyOnceWith('a', ['r', 'u']);
    expect(rows[0]).toMatchObject({ raw_material_name: 'Egg', latest_cost: 3.6, reference_number: 'P' });
    expect(rows[1]).toMatchObject({ latest_cost: null, price_source: 'unpriced' });
  });
  it('rejects missing metadata and price failures instead of showing partial zero prices', async () => {
    mocks.prices.mockRejectedValueOnce(new Error('price unavailable'));
    await expect(loadRawLatestPriceRows('a')).rejects.toThrow('price unavailable');
    mocks.pages.mockRejectedValueOnce(new Error('metadata unavailable'));
    await expect(loadRawLatestPriceRows('a')).rejects.toThrow('metadata unavailable');
  });
  it('does not attach a different branch price to a material', async () => {
    mocks.prices.mockResolvedValue([{ raw_material_id: 'r', branch_id: 'b', unit_cost: 99, price_source: 'purchase' }]);
    expect((await loadRawLatestPriceRows('a'))[0]).toMatchObject({ latest_cost: null, price_source: 'unpriced', branch_id: 'a' });
  });
});
