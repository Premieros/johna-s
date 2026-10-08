import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRawCurrentPrices } from '@/features/costing/services/rawCurrentPriceData';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), read: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
beforeEach(() => {
  mocks.rpc.mockReset().mockImplementation((_name, args) => ({ order: async () => ({ data: args.p_raw_material_ids.map((id: string) => ({ raw_material_id: id, unit_cost: 5 })), error: null }) }));
  mocks.read.mockReset().mockResolvedValue({ data: [{ id: 'raw' }], error: null });
  const query = { select: vi.fn(), order: vi.fn(), range: vi.fn(), eq: vi.fn(), then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => mocks.read().then(resolve, reject) };
  query.select.mockReturnValue(query); query.order.mockReturnValue(query); query.range.mockReturnValue(query); query.eq.mockReturnValue(query);
  mocks.from.mockReset().mockReturnValue(query);
});
describe('bounded authoritative current-price reads', () => {
  it('returns every price in bounded requests and deduplicates supplied identities', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `r${i}`);
    const rows = await loadRawCurrentPrices('branch', [...ids, ids[0]]);
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map(row => row.raw_material_id)).size).toBe(205);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc.mock.calls.map(call => call[1].p_raw_material_ids.length)).toEqual([100, 100, 5]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects an incomplete read instead of returning prices from successful batches', async () => {
    const error = { code: '57014', message: 'timeout' };
    mocks.rpc.mockImplementationOnce((_name, args) => ({ order: async () => ({ data: args.p_raw_material_ids.map((id: string) => ({ raw_material_id: id })), error: null }) })).mockImplementationOnce(() => ({ order: async () => ({ data: null, error }) }));
    await expect(loadRawCurrentPrices('branch', Array.from({ length: 105 }, (_, i) => `r${i}`))).rejects.toEqual(error);
  });
  it('enumerates only the requested branch before pricing and skips empty selections', async () => {
    expect(await loadRawCurrentPrices('branch', [])).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await loadRawCurrentPrices('branch');
    expect(mocks.from).toHaveBeenCalledWith('raw_materials');
    expect(mocks.from.mock.results[0].value.eq).toHaveBeenCalledWith('branch_id', 'branch');
    expect(mocks.rpc).toHaveBeenCalledWith('get_raw_material_current_prices', { p_branch_id: 'branch', p_raw_material_ids: ['raw'] });
  });
});
