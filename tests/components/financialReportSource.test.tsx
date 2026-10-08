import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ branch: 'A', income: vi.fn() }));
vi.mock('@/api', () => ({ reporting: { getIncomeStatement: mocks.income } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'reader' } }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ unlimited: true, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/lib/excel', () => ({ exportToExcelAdvanced: vi.fn() }));
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
const data = { revenue: 123, discount: 0, net_revenue: 123, cogs: 0, gross_profit: 123, expenses: 0, net_income: 123 };
const page = () => <MemoryRouter initialEntries={['/?view=income&from=2026-10-01&to=2026-10-07']}><FinancialReportsPage /></MemoryRouter>;
beforeEach(() => { mocks.branch = 'A'; mocks.income.mockReset(); });
describe('financial canonical report reads', () => {
  it('shows an API failure and blocks exporting old or empty results', async () => {
    mocks.income.mockResolvedValue({ data: null, error: { message: 'SOURCE_FAILED' } });
    render(page());
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'exportExcel' })).toBeDisabled();
    expect(screen.queryByText('123.00 EGP')).toBeNull();
  });
  it('aborts old scope, rejects its late result and exports only the active branch result', async () => {
    let resolve!: (value: { data: typeof data; error: null }) => void;
    mocks.income.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const view = render(page());
    await waitFor(() => expect(mocks.income).toHaveBeenCalled());
    const signal = mocks.income.mock.calls[0][1] as AbortSignal;
    mocks.branch = 'B';
    mocks.income.mockResolvedValue({ data: { ...data, revenue: 456, net_revenue: 456, gross_profit: 456, net_income: 456 }, error: null });
    view.rerender(page());
    await waitFor(() => expect(screen.getByRole('button', { name: 'exportExcel' })).not.toBeDisabled());
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data, error: null }));
    expect(screen.queryByText(/123[.,]00/)).toBeNull();
    expect(mocks.income.mock.calls[mocks.income.mock.calls.length - 1][0].p_branch_id).toBe('B');
  });
});
