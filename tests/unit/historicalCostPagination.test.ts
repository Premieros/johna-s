import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/api/rpc', () => ({ rpc: mocks.rpc }));
import { costing } from '@/api/domains/costing';
beforeEach(() => { mocks.rpc.mockReset(); });
describe('complete historical cost response', () => {
  it('keeps more than the REST set-row cap in one scalar JSON response', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ sale_id: `sale-${i}`, estimated_cost: 1, priced_movements: 1, unpriced_movements: 0 }));
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const result = await costing.getHistoricalSaleCostEstimates({ p_branch_id: 'branch', p_from: '2026-09-01', p_to: '2026-10-08' });
    expect(result.data).toHaveLength(1200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_historical_sale_cost_estimates', { p_branch_id: 'branch', p_from: '2026-09-01', p_to: '2026-10-08' });
  });
  it('keeps a failed historical read as an error rather than a zero supplement', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Read failed' } });
    const result = await costing.getHistoricalSaleCostEstimates({});
    expect(result.data).toBeNull(); expect(result.error?.message).toBe('Read failed');
  });
});
