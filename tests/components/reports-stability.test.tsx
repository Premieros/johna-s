import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted(() => ({
  branch: 'a',
  userId: 'reader',
  branches: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  loadSales: vi.fn(),
  loadOptions: vi.fn(),
  print: vi.fn(),
  excel: vi.fn(),
}));
vi.mock('@/api', () => ({ supabase: {}, costing: {}, reporting: {} }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ unlimited: true, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: mocks.branches }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/features/reporting/useColumnPreferences', () => ({ useColumnPreferences: () => ({ visibleColumns: null, toggleColumn: vi.fn(), showAllColumns: vi.fn() }) }));
vi.mock('@/features/reporting/useCustomReports', () => ({ useCustomReports: () => ({ savedReports: [], saveReport: vi.fn(), deleteReport: vi.fn() }) }));
vi.mock('@/features/reporting/ColumnPicker', () => ({ ColumnPicker: () => null }));
vi.mock('@/features/reporting/CustomReportBar', () => ({ CustomReportBar: () => null }));
vi.mock('@/features/reporting/services/reportCoreLoaders', () => ({ loadSalesReportRows: mocks.loadSales, loadPurchaseReportRows: vi.fn(), loadExpenseReportRows: vi.fn() }));
vi.mock('@/features/reporting/services/reportFilterOptions', () => ({
  loadReportFilterOptions: mocks.loadOptions,
  loadExpenseCategoryOptions: async () => [],
}));
vi.mock('@/lib/reportExport', () => ({ openPrintWindow: mocks.print, downloadCSV: vi.fn() }));
vi.mock('@/lib/excel', () => ({ exportToExcelAdvanced: mocks.excel }));
vi.mock('@/features/reporting/ReportFilterBar', () => ({ ReportFilterBar: (props: { total: number; count: number; from: string; onFromChange: (s: string) => void; onRunReport: () => void; filters: { warehouse?: string; customer?: string; payment_method?: string }; onFilterChange: (key: 'warehouse' | 'customer' | 'payment_method', value: string) => void }) => (
  <div><output data-testid="report-summary">{props.total}:{props.count}</output><input aria-label="From" value={props.from} onChange={e => props.onFromChange(e.target.value)} /><input aria-label="Warehouse filter" value={props.filters.warehouse || ''} onChange={e => props.onFilterChange('warehouse', e.target.value)} /><input aria-label="Customer filter" value={props.filters.customer || ''} onChange={e => props.onFilterChange('customer', e.target.value)} /><input aria-label="Payment filter" value={props.filters.payment_method || ''} onChange={e => props.onFilterChange('payment_method', e.target.value)} /><button onClick={props.onRunReport}>Run report</button></div>
) }));
import { ReportsPage } from '@/features/reporting/pages/ReportsPage';
function page(props: ComponentProps<typeof ReportsPage> = {}) { return <MemoryRouter><ReportsPage {...props} /></MemoryRouter>; }
function sale(invoice: string, branch = 'a', total = 10) { return { id: invoice, invoice_number: invoice, branch_id: branch, created_at: '2026-10-05T08:00:00Z', total, paid_amount: total, refunded_amount: 0 }; }
function deferred() {
  let resolve!: (rows: Record<string, unknown>[]) => void;
  const promise = new Promise<Record<string, unknown>[]>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.branch = 'a'; mocks.userId = 'reader'; mocks.loadOptions.mockReset().mockResolvedValue({ warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [] }); });

describe('report read stability', () => {
  it('shows filter-specific failures and retries options without rerunning a successful report', async () => {
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    mocks.loadOptions.mockRejectedValueOnce(new Error('NETWORK_ERROR'));
    render(page());
    await screen.findByRole('alert', { name: 'Filter loading error' });
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry filters' }));
    await waitFor(() => expect(screen.queryByRole('alert', { name: 'Filter loading error' })).toBeNull());
    expect(mocks.loadOptions).toHaveBeenCalledTimes(2);
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
  });

  it('bounds screen rows but prints/exports full rows and retains full totals', async () => {
    mocks.loadSales.mockResolvedValue(Array.from({ length: 205 }, (_, i) => sale(`invoice-${i}`)));
    render(page());
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('2050:205'));
    const body = () => within(screen.getByRole('table').querySelector('tbody')!);
    expect(body().queryByText('invoice-204')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(body().getByText('invoice-204')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(mocks.print.mock.calls[0][0].rows).toHaveLength(205);
    fireEvent.click(screen.getByRole('button', { name: 'exportExcel' }));
    expect(mocks.excel.mock.calls[0][0].data).toHaveLength(205);
  });

  it('discards old branch results including old summary and clears scope before paint', async () => {
    const first = deferred(); const second = deferred();
    mocks.loadSales.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { rerender } = render(page());
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(1));
    mocks.branch = 'b'; rerender(page());
    expect(screen.getByTestId('report-summary').textContent).toBe('0:0');
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve([sale('B-sale', 'b', 20)]); });
    await act(async () => { first.resolve([sale('A-sale', 'a', 999)]); });
    expect(screen.getByTestId('report-summary').textContent).toBe('20:1');
    expect(screen.queryByText('A-sale')).toBeNull();
  });

  it.each(['branch', 'user'])('clears scoped selections on %s change without querying the new scope with old identifiers', async (scope) => {
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    const { rerender } = render(page());
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Warehouse filter'), { target: { value: 'warehouse-a' } });
    fireEvent.change(screen.getByLabelText('Customer filter'), { target: { value: 'customer-a' } });
    fireEvent.change(screen.getByLabelText('Payment filter'), { target: { value: 'cash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(2));
    expect(mocks.loadSales.mock.calls[1][0].filters).toMatchObject({ warehouse: 'warehouse-a', customer: 'customer-a', payment_method: 'cash' });
    if (scope === 'branch') mocks.branch = 'b'; else mocks.userId = 'new-reader';
    rerender(page());
    expect(screen.getByLabelText('Warehouse filter')).toHaveValue('');
    expect(screen.getByLabelText('Customer filter')).toHaveValue('');
    expect(screen.getByLabelText('Payment filter')).toHaveValue('cash');
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(3));
    expect(mocks.loadSales.mock.calls[2][0]).toMatchObject({ branchId: mocks.branch, filters: { payment_method: 'cash' } });
    expect(mocks.loadSales.mock.calls[2][0].filters.warehouse).toBeUndefined();
    expect(mocks.loadSales.mock.calls[2][0].filters.customer).toBeUndefined();
  });

  it('shows a read failure, prevents empty printing, and retries successfully', async () => {
    mocks.loadSales.mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce([sale('retry-sale')]);
    render(page());
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'print' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('applies draft dates only when Run report is pressed', async () => {
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    render(page());
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(2));
    expect(mocks.loadSales.mock.calls[1][0].fromTs).toContain('2026-09-30');
  });
});
