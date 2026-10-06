import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDashboardOpsRows, loadDashboardStockRows, loadDashboardFallbackSales } from '@/features/dashboard/services/dashboardRawData';
const mocks = vi.hoisted(() => ({ from: vi.fn(), replies: {} as Record<string, Array<{ data: unknown[] | null; error: unknown } | Error>> }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
beforeEach(() => {
  mocks.replies = {};
  mocks.from.mockReset().mockImplementation((table: string) => {
    const reply = mocks.replies[table]?.shift() || { data: [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'limit', 'gte', 'lte', 'neq', 'order']) query[method] = vi.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)).then(resolve, reject);
    return query;
  });
});
const args = { branchId: 'smouha', fromIso: '2026-10-05T21:00:00Z', toIso: '2026-10-06T20:59:59Z', fromDate: '2026-10-06', toDate: '2026-10-06', includePos: true, includePurchases: true, includeExpenses: true };
describe('dashboard read failures never masquerade as successful zeros', () => {
  it.each([{ data: null, error: { message: 'denied' } }, new Error('offline')])('isolates failed orders while retaining successful purchases/expenses %#', async failure => {
    mocks.replies.orders = [failure];
    mocks.replies.purchases = [{ data: [{ total: 200 }], error: null }];
    mocks.replies.expenses = [{ data: [{ amount: 30 }], error: null }];
    expect(await loadDashboardOpsRows(args)).toMatchObject({ orders: [], ordersFailed: true, purchases: [{ total: 200 }], purchasesFailed: false, expenses: [{ amount: 30 }], expensesFailed: false });
    const query = mocks.from.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith('branch_id', 'smouha');
    expect(query.in).toHaveBeenCalledWith('status', ['open', 'held']);
  });
  it('does not query sections without their permission', async () => {
    const result = await loadDashboardOpsRows({ ...args, includePos: false, includePurchases: false, includeExpenses: false });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ordersFailed: false, purchasesFailed: false, expensesFailed: false });
    await loadDashboardStockRows({ enabled: false, branchId: 'smouha' });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('marks failed stock as unavailable and permits a fresh retry', async () => {
    mocks.replies.raw_material_inventory = [new Error('offline')];
    expect((await loadDashboardStockRows({ enabled: true, branchId: 'smouha' })).failed).toBe(true);
    expect((await loadDashboardStockRows({ enabled: true, branchId: 'smouha' })).failed).toBe(false);
  });
  it('reports comparison and product-detail failures separately from current sales', async () => {
    mocks.replies.sales = [{ data: [{ id: 'sale1' }], error: null }, { data: null, error: { message: 'previous unavailable' } }];
    mocks.replies.sale_items = [new Error('items offline')];
    const result = await loadDashboardFallbackSales({ branchId: 'smouha', currentFrom: args.fromIso, currentTo: args.toIso, previousFrom: '2026-10-04T21:00:00Z', previousTo: '2026-10-05T20:59:59Z' });
    expect(result).toMatchObject({ currentRows: [{ id: 'sale1' }], currentErrorMessage: null, previousErrorMessage: 'previous unavailable', itemRows: [], itemErrorMessage: 'READ_FAILED' });
  });
});
