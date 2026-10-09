import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted(() => ({
  branch: 'a',
  userId: 'reader',
  branches: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  loadSales: vi.fn(),
  materialBalances: vi.fn(),
  stationLines: vi.fn(),
  fullSales: vi.fn(),
  loadOptions: vi.fn(),
  print: vi.fn(),
  excel: vi.fn(),
  csv: vi.fn(),
  visibleColumns: null as string[] | null,
  columnOrder: undefined as string[] | undefined,
}));
vi.mock('@/api', () => ({ supabase: {}, costing: {}, reporting: { getRawMaterialConsumptionReport: mocks.materialBalances } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ unlimited: true, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: mocks.branches }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/features/reporting/useColumnPreferences', () => ({ useColumnPreferences: () => ({ visibleColumns: mocks.visibleColumns, columnOrder: mocks.columnOrder, toggleColumn: vi.fn(), showAllColumns: vi.fn() }) }));
vi.mock('@/features/reporting/useCustomReports', () => ({ useCustomReports: () => ({ savedReports: [], saveReport: vi.fn(), deleteReport: vi.fn() }) }));
vi.mock('@/features/reporting/ColumnPicker', () => ({ ColumnPicker: () => null }));
vi.mock('@/features/reporting/CustomReportBar', () => ({ CustomReportBar: () => null }));
vi.mock('@/features/reporting/services/reportCoreLoaders', () => ({ loadOperationalReportPage: async (args: { page: number }) => {
  const rows = await mocks.loadSales(args) as Record<string, unknown>[];
  return { rows: rows.slice(args.page * 100, args.page * 100 + 100), summary: { count: rows.length, total: rows.reduce((sum, row) => sum + Math.max(0, Number(row.total || 0) - Number(row.refunded_amount || 0)), 0) } };
}, loadSalesReportRows: mocks.fullSales, loadPurchaseReportRows: vi.fn(), loadExpenseReportRows: vi.fn() }));
vi.mock('@/features/reporting/services/reportFilterOptions', () => ({
  loadReportFilterOptions: mocks.loadOptions,
  loadExpenseCategoryOptions: async () => [],
}));
vi.mock('@/lib/reportExport', () => ({ openPrintWindow: mocks.print, downloadCSV: mocks.csv }));
vi.mock('@/lib/excel', () => ({ exportToExcelAdvanced: mocks.excel }));
vi.mock('@/features/reporting/ReportFilterBar', () => ({ ReportFilterBar: (props: { total: number; count: number; from: string; onFromChange: (s: string) => void; onRunReport: () => void; filters: { warehouse?: string; customer?: string; payment_method?: string }; onFilterChange: (key: 'warehouse' | 'customer' | 'payment_method', value: string) => void }) => (
  <div><output data-testid="report-summary">{props.total}:{props.count}</output><input aria-label="From" value={props.from} onChange={e => props.onFromChange(e.target.value)} /><input aria-label="Warehouse filter" value={props.filters.warehouse || ''} onChange={e => props.onFilterChange('warehouse', e.target.value)} /><input aria-label="Customer filter" value={props.filters.customer || ''} onChange={e => props.onFilterChange('customer', e.target.value)} /><input aria-label="Payment filter" value={props.filters.payment_method || ''} onChange={e => props.onFilterChange('payment_method', e.target.value)} /><button onClick={props.onRunReport}>Run report</button></div>
) }));
vi.mock('@/features/reporting/services/stationSalesReport', () => ({ loadStationSalesLines: mocks.stationLines }));
import { ReportsPage } from '@/features/reporting/pages/ReportsPage';
function page(props: ComponentProps<typeof ReportsPage> = {}) { return <MemoryRouter><ReportsPage {...props} /></MemoryRouter>; }
function sale(invoice: string, branch = 'a', total = 10) { return { id: invoice, invoice_number: invoice, branch_id: branch, created_at: '2026-10-05T08:00:00Z', total, paid_amount: total, refunded_amount: 0 }; }
function deferred() {
  let resolve!: (rows: Record<string, unknown>[]) => void;
  const promise = new Promise<Record<string, unknown>[]>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.visibleColumns = null; mocks.columnOrder = undefined; vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn() } as unknown as Window); mocks.fullSales.mockReset().mockResolvedValue([]); mocks.branch = 'a'; mocks.userId = 'reader'; mocks.loadOptions.mockReset().mockResolvedValue({ warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [] }); });

describe('report read stability', () => {
  it('does not request results on mount, filter changes or a report-type change', async () => {
    mocks.loadSales.mockResolvedValue([sale('manual')]);
    const view = render(page());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mocks.loadSales).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'exportExcel' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    expect(mocks.loadSales).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledOnce());
    view.rerender(page({ controlledReportType: 'sales_costs' }));
    expect(mocks.stationLines).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'exportExcel' })).toBeDisabled();
  });
  it('reuses reads across equivalent branch lookup refreshes and reloads changed labels', async () => {
    mocks.loadSales.mockResolvedValue([sale('stable-branch')]);
    const view = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    mocks.branches = mocks.branches.map(branch => ({ ...branch }));
    view.rerender(page());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    const previous = mocks.branches;
    mocks.branches = mocks.branches.map(branch => ({ ...branch, name: branch.name + ' updated' }));
    view.rerender(page());
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(2));
    mocks.branches = previous;
  });

  it('keeps selected column order across full-report Excel, CSV and print exports', async () => {
    mocks.visibleColumns = ['Branch', 'Invoice'];
    mocks.columnOrder = ['Invoice', 'Branch'];
    const all = Array.from({ length: 205 }, (_, i) => sale(`invoice-${i}`));
    mocks.loadSales.mockResolvedValue(all); mocks.fullSales.mockResolvedValue(all);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('2050:205'));
    const headers = screen.getByRole('table').querySelectorAll('thead th');
    expect(Array.from(headers).map(header => header.textContent)).toEqual(['Invoice', 'Branch']);
    fireEvent.click(screen.getByRole('button', { name: 'exportExcel' }));
    await waitFor(() => expect(mocks.excel).toHaveBeenCalled());
    expect(mocks.excel.mock.calls[0][0].columns).toEqual(['Invoice', 'Branch']);
    expect(mocks.excel.mock.calls[0][0].data).toHaveLength(205);
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    await waitFor(() => expect(mocks.csv).toHaveBeenCalled());
    expect(mocks.csv.mock.calls[0][0]).toHaveLength(205);
    expect(Object.keys(mocks.csv.mock.calls[0][0][0])).toEqual(['Invoice', 'Branch']);
    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalled());
    expect(mocks.print.mock.calls[0][0].headers).toEqual(['Invoice', 'Branch']);
    expect(mocks.print.mock.calls[0][0].rows).toHaveLength(205);
  });

  it('blocks export when every column is hidden instead of revealing all columns', async () => {
    mocks.visibleColumns = [];
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    for (const name of ['exportExcel', 'exportCsv', 'print']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(mocks.excel).not.toHaveBeenCalled();
  });

  it('shows filter-specific failures and retries options without rerunning a successful report', async () => {
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    mocks.loadOptions.mockRejectedValueOnce(new Error('NETWORK_ERROR'));
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await screen.findByRole('alert', { name: 'Filter loading error' });
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry filters' }));
    await waitFor(() => expect(screen.queryByRole('alert', { name: 'Filter loading error' })).toBeNull());
    expect(mocks.loadOptions).toHaveBeenCalledTimes(2);
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
  });

  it('bounds screen rows but prints/exports full rows and retains full totals', async () => {
    const all = Array.from({ length: 205 }, (_, i) => sale(`invoice-${i}`));
    mocks.loadSales.mockResolvedValue(all); mocks.fullSales.mockResolvedValue(all);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('2050:205'));
    const body = () => within(screen.getByRole('table').querySelector('tbody')!);
    expect(body().queryByText('invoice-204')).toBeNull();
    expect(mocks.fullSales).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(body().getByText('invoice-100')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(body().getByText('invoice-204')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    await waitFor(() => expect(mocks.print.mock.calls[0][0].rows).toHaveLength(205));
    fireEvent.click(screen.getByRole('button', { name: 'exportExcel' }));
    await waitFor(() => expect(mocks.excel.mock.calls[0][0].data).toHaveLength(205));
  });

  it('discards old branch results including old summary and clears scope before paint', async () => {
    const first = deferred(); const second = deferred();
    mocks.loadSales.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { rerender } = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(1));
    mocks.branch = 'b'; rerender(page());
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
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
    expect(mocks.loadSales).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(3));
    expect(mocks.loadSales.mock.calls[2][0]).toMatchObject({ branchId: mocks.branch, filters: { payment_method: 'cash' } });
    expect(mocks.loadSales.mock.calls[2][0].filters.warehouse).toBeUndefined();
    expect(mocks.loadSales.mock.calls[2][0].filters.customer).toBeUndefined();
  });

  it('keeps applied dates on Next and full export even if drafts have changed', async () => {
    const all = Array.from({ length: 205 }, (_, i) => sale(`invoice-${i}`));
    mocks.loadSales.mockResolvedValue(all); mocks.fullSales.mockResolvedValue(all);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('2050:205'));
    const appliedFrom = mocks.loadSales.mock.calls[0][0].from;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(2));
    expect(mocks.loadSales.mock.calls[1][0]).toMatchObject({ from: appliedFrom, page: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'exportExcel' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'exportExcel' }));
    await waitFor(() => expect(mocks.excel).toHaveBeenCalled());
    expect(mocks.excel.mock.calls[0][0].filename).toContain(appliedFrom);
    expect(mocks.excel.mock.calls[0][0].filename).not.toContain('2026-01-01');
  });

  it('cancels an obsolete full export and discards its data after a scope change', async () => {
    const full = deferred();
    mocks.loadSales.mockResolvedValue([sale('sale')]); mocks.fullSales.mockReturnValue(full.promise);
    const { rerender } = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    fireEvent.click(screen.getByRole('button', { name: 'exportExcel' }));
    await waitFor(() => expect(mocks.fullSales).toHaveBeenCalled());
    const signal = mocks.fullSales.mock.calls[0][0].signal as AbortSignal;
    mocks.branch = 'b'; rerender(page());
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    expect(signal.aborted).toBe(true);
    await act(async () => { full.resolve([sale('obsolete','a',999)]); });
    expect(mocks.excel).not.toHaveBeenCalled();
  });

  it('does not export a partial report after a full-data read fails', async () => {
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    mocks.fullSales.mockRejectedValue(new Error('NETWORK_ERROR'));
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    fireEvent.click(screen.getByRole('button', { name: 'exportExcel' }));
    await screen.findByRole('alert');
    expect(mocks.excel).not.toHaveBeenCalled();
  });

  it('shows a read failure, prevents empty printing, and retries successfully', async () => {
    mocks.loadSales.mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce([sale('retry-sale')]);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'print' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('applies draft dates only when Run report is pressed', async () => {
    mocks.loadSales.mockResolvedValue([sale('sale')]);
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('10:1'));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.loadSales).toHaveBeenCalledTimes(2));
    expect(mocks.loadSales.mock.calls[1][0].from).toBe('2026-10-01');
  });
});


describe('cost and dated balance views', () => {
  it('reads historical closing values for the selected day, preserving negative balances', async () => {
    mocks.materialBalances.mockResolvedValue({ data: [{ raw_material_name: 'Flour', raw_material_code: 'F', unit_name: 'kg', closing_quantity: -2, closing_value: -30 }], error: null });
    render(<MemoryRouter initialEntries={['/reports?type=inventory_as_of&from=2026-09-01&to=2026-10-05']}><ReportsPage controlledReportType="inventory_as_of" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(screen.getByTestId('report-summary').textContent).toBe('-30:1'));
    expect(mocks.materialBalances.mock.calls[0][0]).toEqual({ p_branch_id: 'a', p_from_date: '2026-10-05', p_to_date: '2026-10-05' });
    expect(screen.getByRole('table').textContent).toContain('-2');
    expect(screen.getByRole('note').textContent).toContain('2026-10-05');
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    await waitFor(() => expect(mocks.csv).toHaveBeenCalled());
    expect(mocks.csv.mock.calls[0][0][0]['End-of-day Recorded Value']).toBe(-30);
    expect(mocks.materialBalances).toHaveBeenCalledTimes(1);
  });
  it('defaults to estimated sales cost and reads actual FIFO only on direct request', async () => {
    const line = { sale: sale('COST'), item: { product: { name: 'Meal' }, unit_name: 'piece' }, station: 'Kitchen', category: 'Meals', netQuantity: 1, netBeforeTax: 100, net: 114, cost: 25, estimatedCost: 40, knownEstimatedCost: 40, unpricedMaterials: [] };
    mocks.stationLines.mockResolvedValue([line, { ...line, sale: sale('UNPRICED'), cost: null, estimatedCost: null, knownEstimatedCost: 12, unpricedMaterials: ['Oil'] }]);
    render(page({ controlledReportType: 'sales_costs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await screen.findAllByText('UNPRICED');
    expect(mocks.stationLines.mock.calls[0][0]).toMatchObject({ includeCost: true, costMode: 'estimated' });
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    await waitFor(() => expect(mocks.csv).toHaveBeenCalledTimes(1));
    const estimatedRows = mocks.csv.mock.calls[0][0];
    expect(estimatedRows[0]['Current-price Sold Cost']).toBe(40);
    expect(estimatedRows[0]['Recorded Cost']).toBeUndefined();
    expect(estimatedRows[1]['Current-price Sold Cost']).toBe(12);
    expect(estimatedRows[1]['Unpriced Materials']).toBe('Oil');
    expect(estimatedRows[1]['Current-price Gross Profit']).toBe('Unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate actual cost (FIFO)' }));
    await waitFor(() => expect(mocks.stationLines).toHaveBeenCalledTimes(2));
    expect(mocks.stationLines.mock.calls[1][0].costMode).toBe('actual');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show estimated cost only' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    await waitFor(() => expect(mocks.csv).toHaveBeenCalledTimes(2));
    const actualRows = mocks.csv.mock.calls[1][0];
    expect(actualRows[0]['Recorded Cost']).toBe(25);
    expect(actualRows[0]['Recorded Gross Profit']).toBe(75);
    expect(actualRows[1]['Recorded Cost']).toBe('Unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await waitFor(() => expect(mocks.stationLines).toHaveBeenCalledTimes(3));
    expect(mocks.stationLines.mock.calls[2][0].costMode).toBe('estimated');
    expect(mocks.loadSales).not.toHaveBeenCalled();
  });
  it('blocks dated balance exports when a source fails', async () => {
    mocks.materialBalances.mockResolvedValue({ data: null, error: { message: 'SOURCE_FAILURE' } });
    render(page({ controlledReportType: 'inventory_as_of' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'exportCsv' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.csv).not.toHaveBeenCalled();
  });
});
