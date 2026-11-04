import { beforeEach, expect, it, vi } from 'vitest';
import { fetchActiveOrders } from '@/features/pos/services/posOrders';
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), replies: {} as Record<string, unknown> }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc }, pos: {} }));
beforeEach(() => {
  mocks.replies = {}; mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.from.mockReset().mockImplementation((table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order']) query[method] = () => query;
    query.then = (resolve: (value: unknown) => void) => Promise.resolve(mocks.replies[table] || { data: [], error: null }).then(resolve);
    return query;
  });
});
it.each(['orders', 'dining_tables'])('keeps a failed %s read from becoming a fake empty snapshot or extra label RPC', async table => {
  const error = { code: '57014', message: 'statement timeout' };
  mocks.replies[table] = { data: null, error };
  await expect(fetchActiveOrders('a')).rejects.toBe(error);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('allows a successful empty snapshot and a fresh retry after failure', async () => {
  mocks.replies.orders = { data: null, error: { code: '57014' } };
  await expect(fetchActiveOrders('retry')).rejects.toMatchObject({ code: '57014' });
  mocks.replies.orders = { data: [], error: null };
  expect(await fetchActiveOrders('retry')).toMatchObject({ orders: [], tables: [], watchedOrderIds: [] });
});
