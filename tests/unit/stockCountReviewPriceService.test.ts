import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { rpc: rpcMock, from: vi.fn() } }));

import { loadStockCountReviewPrices } from '@/features/inventory/services/stockCountData';

describe('stock count review price service', () => {
  beforeEach(() => rpcMock.mockReset());

  it('uses the canonical branch price RPC and preserves explicit zero and unpriced NULL', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { raw_material_id: 'priced', unit_cost: '0', price_source: 'approved_purchase' },
        { raw_material_id: 'unpriced', unit_cost: null, price_source: null },
      ],
      error: null,
    });

    await expect(loadStockCountReviewPrices('branch-1', ['priced', 'unpriced'])).resolves.toEqual({
      priced: { unit_cost: 0, price_source: 'approved_purchase' },
      unpriced: { unit_cost: null, price_source: 'unpriced' },
    });
    expect(rpcMock).toHaveBeenCalledWith('get_raw_material_current_prices', {
      p_branch_id: 'branch-1',
      p_raw_material_ids: ['priced', 'unpriced'],
    });
  });

  it('awaits a Supabase-style PromiseLike that has no catch method', async () => {
    const response = { data: [], error: null };
    const thenable = {
      then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
    };
    expect('catch' in thenable).toBe(false);
    rpcMock.mockReturnValue(thenable);

    await expect(loadStockCountReviewPrices('branch-1', ['raw-1'])).resolves.toEqual({});
  });

  it('propagates RPC errors to the page service boundary', async () => {
    const error = new Error('price source unavailable');
    rpcMock.mockResolvedValue({ data: null, error });

    await expect(loadStockCountReviewPrices('branch-1', ['raw-1'])).rejects.toBe(error);
  });
});
