import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ range: vi.fn(), order: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { costing } from '@/api/domains/costing';
beforeEach(() => { mocks.range.mockReset(); mocks.order.mockReset().mockReturnValue({ range: mocks.range }); mocks.rpc.mockReset().mockReturnValue({ order: mocks.order }); });
describe('historical cost pagination', () => {
  it('reads beyond the REST row cap with deterministic invoice ordering', async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ sale_id: `sale-${i}`, estimated_cost: 1, priced_movements: 1, unpriced_movements: 0 }));
    mocks.range.mockResolvedValueOnce({ data: page, error: null }).mockResolvedValueOnce({ data: [{ ...page[0], sale_id: 'last' }], error: null });
    const result = await costing.getHistoricalSaleCostEstimates({ p_branch_id: 'branch', p_from: '2026-09-01', p_to: '2026-10-08' });
    expect(result.data).toHaveLength(501);
    expect(mocks.order).toHaveBeenCalledWith('sale_id');
    expect(mocks.range.mock.calls).toEqual([[0,499],[500,999]]);
  });
  it('fails a partially loaded correction rather than returning an incomplete total', async () => {
    mocks.range.mockResolvedValueOnce({ data: Array(500).fill({ sale_id: 'sale', estimated_cost: 1 }), error: null }).mockResolvedValueOnce({ data: null, error: { message: 'Page failed' } });
    const result = await costing.getHistoricalSaleCostEstimates({});
    expect(result.data).toBeNull(); expect(result.error?.message).toBe('Page failed');
  });
});
