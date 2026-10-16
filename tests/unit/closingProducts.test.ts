import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ from: vi.fn(), range: vi.fn(), eq: vi.fn(), ids: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { from: m.from } }));
import { loadClosingProducts } from '@/features/trade/services/closingProducts';
beforeEach(() => {
  vi.clearAllMocks();
  const q = { select: vi.fn().mockReturnThis(), eq: m.eq, in: m.ids, order: vi.fn().mockReturnThis(), range: m.range };
  m.from.mockReturnValue(q); m.eq.mockReturnValue(q); m.ids.mockReturnValue(q);
  m.range.mockResolvedValue({ data: [], error: null });
});
const row = (id: string, overrides = {}) => ({ id, product_id: 'burger', unit_name: 'piece', quantity: 3, unit_price: 20, total: 60, refunded_quantity: 1, refunded_amount: 20, product: { name: 'Burger' }, ...overrides });
describe('closing sold products read', () => {
  it('does not read history for an empty authorized cohort', async () => {
    expect(await loadClosingProducts('smouha', [])).toEqual([]); expect(m.from).not.toHaveBeenCalled();
  });
  it('uses explicit branch and sale IDs, nets returns and separates unlike units without repricing free items', async () => {
    m.range.mockResolvedValue({ data: [row('a'), row('b'), row('c', { unit_name: 'box' }), row('d', { product_id: 'free', total: 0, refunded_quantity: 0, refunded_amount: 0 })] });
    const result = await loadClosingProducts('smouha', ['sale-1', 'sale-1']);
    expect(m.eq).toHaveBeenCalledWith('sale.branch_id', 'smouha');
    expect(m.ids).toHaveBeenCalledExactlyOnceWith('sale_id', ['sale-1']);
    expect(result.find(p => p.productId === 'burger' && p.unitName === 'piece')).toMatchObject({ quantity: 4, total: 80 });
    expect(result.find(p => p.unitName === 'box')).toMatchObject({ quantity: 2, total: 40 });
    expect(result.find(p => p.productId === 'free')).toMatchObject({ quantity: 3, total: 0 });
  });
  it('pages past 500 lines and batches beyond 100 sales without duplicates', async () => {
    m.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => row(String(i))) })
      .mockResolvedValueOnce({ data: [row('last')] }).mockResolvedValueOnce({ data: [row('batch2')] });
    const result = await loadClosingProducts('smouha', Array.from({ length: 101 }, (_, i) => `sale-${i}`));
    expect(m.range.mock.calls).toEqual([[0, 499], [500, 999], [0, 499]]);
    expect(m.ids.mock.calls.map(args => args[1].length)).toEqual([100, 100, 1]);
    expect(result).toMatchObject([{ quantity: 1004, total: 20080 }]);
  });
  it('rejects a partial report on any page failure', async () => {
    m.range.mockResolvedValue({ data: null, error: { message: 'TIMEOUT' } });
    await expect(loadClosingProducts('smouha', ['sale'])).rejects.toThrow('DAY_REPORT_PRODUCTS_LOAD_FAILED: TIMEOUT');
  });
});
