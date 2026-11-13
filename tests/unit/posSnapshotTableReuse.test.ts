import { beforeEach, expect, it, vi } from 'vitest';
import { fetchActiveOrders } from '@/features/pos/services/posOrders';

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), tables: [] as unknown[], missing: [] as unknown[], orders: [] as unknown[], error: null as unknown, queries: [] as Array<{ table: string; select: string; filters: Array<[string, unknown]> }> }));
vi.mock('@/api', () => ({ supabase: { from: mock.from, rpc: mock.rpc }, pos: {} }));
beforeEach(() => {
  mock.tables = []; mock.missing = []; mock.orders = []; mock.error = null; mock.queries = [];
  mock.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  mock.from.mockReset().mockImplementation((table: string) => {
    const record = { table, select: '', filters: [] as Array<[string, unknown]> };
    mock.queries.push(record);
    const query = {
      select: vi.fn((value: string) => { record.select = value; return query; }),
      eq: vi.fn((key: string, value: unknown) => { record.filters.push([key, value]); return query; }),
      in: vi.fn((key: string, value: unknown) => { record.filters.push([key, value]); return query; }),
      order: vi.fn(() => query),
      then: (resolve: (value: unknown) => void) => {
        const fallback = table === 'dining_tables' && record.filters.some(([key]) => key === 'id');
        return Promise.resolve({ data: table === 'orders' ? mock.orders : fallback ? mock.missing : mock.tables, error: fallback ? mock.error : null }).then(resolve);
      },
    };
    return query;
  });
});
const order = (id: string, tableId: string | null) => ({ id, branch_id: 'branch', table_id: tableId, cashier_id: null, status: 'open', order_items: [{ id: `item-${id}`, order_id: id, quantity: 1 }], order_kitchen_sends: [{ id: `send-${id}`, order_id: id }] });

it('hydrates many orders from the already loaded tables without a repeated embedded join', async () => {
  const table = { id: 't1', branch_id: 'branch', name: 'Table 1', is_active: true };
  mock.tables = [table]; mock.orders = [order('o1', 't1'), order('o2', 't1')];
  const result = await fetchActiveOrders('reuse');
  expect(mock.queries).toHaveLength(2);
  expect(mock.queries.find(q => q.table === 'orders')?.select).not.toContain('dining_tables');
  expect(result.orders.map(o => o.table)).toEqual([table, table]);
  expect(result.orderItems).toHaveLength(2); expect(result.kitchenSends).toHaveLength(2);
  expect(result.watchedOrderIds).toEqual(['o1', 'o2']);
});

it('keeps inactive-table details with one deduplicated branch-scoped fallback read', async () => {
  const table = { id: 'inactive', branch_id: 'branch', name: 'Closed area', is_active: false };
  mock.orders = [order('o1', 'inactive'), order('o2', 'inactive')]; mock.missing = [table];
  const result = await fetchActiveOrders('inactive-branch');
  expect(mock.queries).toHaveLength(3);
  expect(mock.queries[2].filters).toEqual([['branch_id', 'inactive-branch'], ['id', ['inactive']]]);
  expect(result.orders.map(o => o.table)).toEqual([table, table]);
  expect(result.tables).toEqual([]); // Inactive tables do not enter the active floor plan.
});

it('keeps takeaway and unavailable table details absent', async () => {
  mock.orders = [order('takeaway', null), order('missing', 'not-readable')];
  const result = await fetchActiveOrders('missing-branch');
  expect(mock.queries[2].filters).toContainEqual(['id', ['not-readable']]);
  expect(result.orders.map(o => o.table)).toEqual([undefined, undefined]);
});

it('rejects fallback errors rather than publishing partial tables or reading labels', async () => {
  mock.orders = [order('o', 'inactive')]; mock.error = { code: '57014' };
  await expect(fetchActiveOrders('failed-fallback')).rejects.toBe(mock.error);
  expect(mock.rpc).not.toHaveBeenCalled();
});
