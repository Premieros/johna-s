import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRawMaterialDisplayPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/api', () => ({ supabase: mocks }));
beforeEach(() => { mocks.rpc.mockReset(); mocks.from.mockReset(); });
describe('latest approved material cost display', () => {
  it('uses approved prices without reading or overlaying FIFO inventory', async () => {
    mocks.rpc.mockReturnValue({ order: async () => ({ data: [{ raw_material_id: 'raw', branch_id: 'branch', unit_cost: 14, price_source: 'pricing' }], error: null }) });
    const rows = await loadRawMaterialDisplayPrices('branch', ['raw']);
    expect(rawCurrentPriceMap(rows)).toEqual({ raw: 14 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_raw_material_current_prices', { p_branch_id: 'branch', p_raw_material_ids: ['raw'] });
  });
  it('retains unpriced materials as unknown and propagates failures', async () => {
    mocks.rpc.mockReturnValue({ order: async () => ({ data: [{ raw_material_id: 'raw', unit_cost: null, price_source: 'unpriced' }], error: null }) });
    expect(rawCurrentPriceMap(await loadRawMaterialDisplayPrices('branch', ['raw']))).toEqual({ raw: null });
    const error = { code: '57014', message: 'timeout' };
    mocks.rpc.mockReturnValue({ order: async () => ({ data: null, error }) });
    await expect(loadRawMaterialDisplayPrices('branch', ['raw'])).rejects.toEqual(error);
  });
});
