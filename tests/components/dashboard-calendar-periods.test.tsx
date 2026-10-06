import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardDataPage } from '@/features/dashboard/pages/DashboardDataPage';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), income: vi.fn(), ops: vi.fn(), stock: vi.fn(), fallback: vi.fn(), permissions: ['sales.view','reports.financial','purchases.view','expenses.view'], branch: 'a', unlimited: false, branches: [{ id: 'a', name: 'A' }] }));
vi.mock('@/api', () => ({ reporting: { getIncomeStatement: mocks.income } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ unlimited: mocks.unlimited }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => mocks.permissions.includes(permission) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: mocks.branches }) }));
vi.mock('@/features/dashboard/components/DashboardStandbyBar', () => ({ DashboardStandbyBar: () => null }));
vi.mock('@/features/dashboard/components/DashboardSalesChart', () => ({ DashboardSalesChart: () => null }));
vi.mock('@/features/dashboard/services/dashboardSnapshot', () => ({ loadDashboardSalesSnapshot: mocks.snapshot }));
vi.mock('@/features/dashboard/services/dashboardRawData', () => ({ loadDashboardStockRows: mocks.stock, loadDashboardOpsRows: mocks.ops, loadDashboardFallbackSales: mocks.fallback }));
const totals = { orders: 1, sales: 100, payments: 100, returns: 0, discounts: 0 };
beforeEach(() => {
  mocks.unlimited = false; mocks.branch = 'a';
  mocks.branches = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  mocks.permissions = ['sales.view','reports.financial','purchases.view','expenses.view'];
  mocks.stock.mockReset().mockResolvedValue({ rawMasters: [], rawBalances: [], unitMasters: [], unitBatches: [], failed: false });
  mocks.fallback.mockReset().mockResolvedValue({ currentRows: [], previousRows: [], itemRows: [], currentErrorMessage: null, previousErrorMessage: null, itemErrorMessage: null });
  mocks.snapshot.mockReset().mockResolvedValue({ current: totals, previous: totals, currentSeries: [], previousSeries: [], orderTypes: [], branches: [], recentSales: [], topProducts: [], paymentMethods: [], previousPaymentMethods: [] });
  mocks.income.mockReset().mockResolvedValue({ data: { expenses: 10, net_income: 90 } });
  mocks.ops.mockReset().mockResolvedValue({ orders: [], purchases: [], expenses: [] });
});
describe('live dashboard period selection', () => {
  it('opens Today and sends the same calendar period to sales, finance and operational reads', async () => {
    render(<MemoryRouter><DashboardDataPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.income).toHaveBeenCalled());
    expect(screen.getByTestId('dashboard-range-today')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('dashboard-range-previous_month'));
    await waitFor(() => expect(screen.getByTestId('dashboard-range-previous_month')).toHaveAttribute('aria-pressed', 'true'));
    const selected = screen.getByTestId('dashboard-selected-dates').textContent!.split(' — ');
    await waitFor(() => expect(mocks.income).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from_date: selected[0], p_to_date: selected[1] }));
    expect(mocks.ops.mock.lastCall![0].toDate).toBe(selected[1]);
    expect(mocks.snapshot.mock.lastCall![0].granularity).toBe('day');
  });
  it('applies custom dates only on Apply and lets limited-history users select the period', async () => {
    render(<MemoryRouter><DashboardDataPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalled());
    const calls = mocks.snapshot.mock.calls.length;
    fireEvent.click(screen.getByTestId('dashboard-range-custom'));
    fireEvent.change(screen.getByTestId('dashboard-custom-from'), { target: { value: '2026-09-04' } });
    fireEvent.change(screen.getByTestId('dashboard-custom-to'), { target: { value: '2026-09-09' } });
    expect(mocks.snapshot.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mocks.income).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from_date: '2026-09-04', p_to_date: '2026-09-09' }));
    expect(mocks.snapshot.mock.lastCall![0]).toMatchObject({ currentFrom: '2026-09-03T21:00:00.000Z', currentTo: '2026-09-09T20:59:59.999Z' });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const ops = (total: number) => ({ orders: [{ total, order_items: [{ quantity: 1 }] }], purchases: [{ total: 20 }], expenses: [{ amount: 5 }] });
const snapshot = (sales: number) => ({ current: { ...totals, sales, payments: sales }, previous: totals, currentSeries: [], previousSeries: [], orderTypes: [], branches: [], recentSales: [], topProducts: [], paymentMethods: [], previousPaymentMethods: [] });
const enableAll = () => { mocks.permissions = ['sales.view', 'reports.view', 'reports.financial', 'pos.view', 'purchases.view', 'expenses.view', 'inventory.view']; };
const waitReady = () => waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
describe('complete dashboard refresh and failure isolation', () => {
  it('refreshes sales, open orders, accounting and stock once per click', async () => {
    enableAll(); mocks.ops.mockResolvedValue(ops(1794));
    render(<MemoryRouter><DashboardDataPage /></MemoryRouter>);
    await waitReady();
    expect(screen.getByTestId('kpi-open-order-value')).toHaveTextContent('1,794.00');
    const counts = [mocks.snapshot, mocks.ops, mocks.income, mocks.stock].map(m => m.mock.calls.length);
    mocks.ops.mockResolvedValue(ops(2000)); mocks.snapshot.mockResolvedValue(snapshot(200));
    mocks.income.mockResolvedValue({ data: { expenses: 20, net_income: 180 } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await waitReady();
    [mocks.snapshot, mocks.ops, mocks.income, mocks.stock].forEach((m, i) => expect(m).toHaveBeenCalledTimes(counts[i] + 1));
    expect(screen.getByTestId('kpi-open-order-value')).toHaveTextContent('2,000.00');
    expect(screen.getByTestId('kpi-net-payments')).toHaveTextContent('200.00');
    expect(screen.getByText('Accounting net profit').parentElement).toHaveTextContent('180.00');
  });
  it('shows unavailable orders without replacing successful purchase/expense values, and retries', async () => {
    enableAll(); mocks.ops.mockResolvedValue({ ...ops(0), ordersFailed: true });
    render(<MemoryRouter><DashboardDataPage /></MemoryRouter>); await waitReady();
    expect(screen.getByTestId('kpi-open-order-value')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-open-order-value')).not.toHaveTextContent('0.00');
    expect(screen.getByTestId('kpi-purchases')).toHaveTextContent('20.00');
    expect(screen.getByRole('status')).toHaveTextContent('Some cards could not be refreshed');
    mocks.ops.mockResolvedValue(ops(1794));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await waitReady();
    expect(screen.getByTestId('kpi-open-order-value')).toHaveTextContent('1,794.00');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('keeps Refresh disabled until the last section finishes and suppresses repeated clicks', async () => {
    const pending = deferred<{ data: { expenses: number; net_income: number } }>();
    mocks.income.mockReturnValue(pending.promise);
    render(<MemoryRouter><DashboardDataPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.ops).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(mocks.ops).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ data: { expenses: 1, net_income: 2 } }); });
    await waitReady();
  });
  it('discards late old-branch operations and finance after a branch switch', async () => {
    enableAll();
    const oldOps = deferred<ReturnType<typeof ops>>();
    const oldFinance = deferred<{ data: { expenses: number; net_income: number } }>();
    mocks.ops.mockReturnValueOnce(oldOps.promise).mockResolvedValue(ops(222));
    mocks.income.mockReturnValueOnce(oldFinance.promise).mockResolvedValue({ data: { expenses: 3, net_income: 50 } });
    const view = render(<MemoryRouter><DashboardDataPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.ops).toHaveBeenCalledTimes(1));
    mocks.branch = 'b'; view.rerender(<MemoryRouter><DashboardDataPage /></MemoryRouter>);
    await waitReady();
    await act(async () => { oldOps.resolve(ops(999)); oldFinance.resolve({ data: { expenses: 99, net_income: 999 } }); });
    expect(screen.getByTestId('kpi-open-order-value')).toHaveTextContent('222.00');
    expect(screen.getByText('Accounting net profit').parentElement).toHaveTextContent('50.00');
    expect(mocks.ops.mock.lastCall![0].branchId).toBe('b');
  });
  it('settles rejected reads, clears stale values and can retry after a failed sales fallback', async () => {
    enableAll(); mocks.snapshot.mockResolvedValue(null); mocks.fallback.mockRejectedValue(new Error('offline'));
    mocks.stock.mockRejectedValue(new Error('offline')); mocks.income.mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><DashboardDataPage /></MemoryRouter>); await waitReady();
    expect(screen.getByTestId('kpi-net-payments')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-net-payments')).not.toHaveTextContent('0.00');
    expect(screen.getByText('Accounting net profit').parentElement).toHaveTextContent('—');
    mocks.snapshot.mockResolvedValue(snapshot(300)); mocks.stock.mockResolvedValue({ failed: false, rawMasters: [], rawBalances: [], unitMasters: [], unitBatches: [] });
    mocks.income.mockResolvedValue({ data: { expenses: 2, net_income: 10 } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await waitReady();
    expect(screen.getByTestId('kpi-net-payments')).toHaveTextContent('300.00');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
