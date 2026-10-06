import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardDataPage } from '@/features/dashboard/pages/DashboardDataPage';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), income: vi.fn(), ops: vi.fn(), branch: 'a', unlimited: false, branches: [{ id: 'a', name: 'A' }] }));
vi.mock('@/api', () => ({ reporting: { getIncomeStatement: mocks.income } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en' }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ unlimited: mocks.unlimited }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => ['sales.view','reports.financial','purchases.view','expenses.view'].includes(permission) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: mocks.branches }) }));
vi.mock('@/features/dashboard/components/DashboardStandbyBar', () => ({ DashboardStandbyBar: () => null }));
vi.mock('@/features/dashboard/components/DashboardSalesChart', () => ({ DashboardSalesChart: () => null }));
vi.mock('@/features/dashboard/services/dashboardSnapshot', () => ({ loadDashboardSalesSnapshot: mocks.snapshot }));
vi.mock('@/features/dashboard/services/dashboardRawData', () => ({ loadDashboardStockRows: async () => ({ failed: true }), loadDashboardOpsRows: mocks.ops }));
const totals = { orders: 1, sales: 100, payments: 100, returns: 0, discounts: 0 };
beforeEach(() => {
  mocks.unlimited = false; mocks.branch = 'a';
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
