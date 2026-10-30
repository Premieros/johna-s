import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CostingCenterPage } from '@/features/costing/pages/CostingCenterPage';
const mocks = vi.hoisted(() => ({ latest: vi.fn(), overview: vi.fn(), rawOverview: vi.fn(), fifo: vi.fn(), prices: vi.fn(), historical: vi.fn(), supplierOptions: vi.fn(), unitOptions: vi.fn(), supplierImpact: vi.fn(), summary: vi.fn(), consumption: vi.fn(), orders: vi.fn(), branches: [{ id: 'a', name: 'A' }], show: vi.fn(), t: (key: string) => key }));
vi.mock('@/features/costing/services/rawLatestPriceData', () => ({ loadRawLatestPriceRows: mocks.latest }));
vi.mock('@/features/costing/services/rawFifoCostData', () => ({ loadRawFifoCosts: mocks.fifo, rawFifoCostMap: () => ({}) }));
vi.mock('@/features/costing/services/rawCurrentPriceData', () => ({ loadRawMaterialDisplayPrices: mocks.prices, rawCurrentPriceMap: () => ({}) }));
vi.mock('@/api', () => ({ costing: {
  getOverview: mocks.overview, getRawMaterialCostOverview: mocks.rawOverview,
  getSupplierPriceImpact: mocks.supplierImpact, getSalesSummary: mocks.summary, getRawConsumptionCostBreakdown: mocks.consumption, getOrderMargin: mocks.orders,
  getHistoricalSaleCostEstimates: mocks.historical,
} }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: mocks.t }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => 'a' }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ minDate: undefined, unlimited: false, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/features/costing/services/costingSelectors', () => ({ loadCostingBranches: async () => mocks.branches, loadCostingSuppliers: mocks.supplierOptions, loadRawMaterialUnitDisplayMap: mocks.unitOptions }));
vi.mock('@/features/costing/components/CostBreakdownButton', () => ({ CostBreakdownButton: () => null }));
beforeEach(() => {
  mocks.latest.mockReset().mockResolvedValue([]);
  mocks.overview.mockReset().mockResolvedValue({ data: [] });
  mocks.rawOverview.mockReset().mockResolvedValue({ data: [] });
  mocks.fifo.mockReset().mockResolvedValue([]);
  mocks.prices.mockReset().mockResolvedValue([]);
  mocks.historical.mockReset().mockResolvedValue({ data: [] });
  mocks.supplierOptions.mockReset().mockResolvedValue([{id: 's', name: 'Supplier'}]);
  mocks.unitOptions.mockReset().mockResolvedValue({});
  mocks.supplierImpact.mockReset().mockResolvedValue({data: []});
  mocks.summary.mockReset().mockResolvedValue({ data: { cogs: 12, net_sales: 100, sales_count: 1, ratio: 12 } });
  mocks.orders.mockReset().mockResolvedValue({ data: [] });
  mocks.consumption.mockReset().mockResolvedValue({ data: [{ raw_material_id: 'r', raw_material_name: 'Sugar', unit_name: 'kg', consumed_quantity: 2, actual_quantity: 1, estimated_quantity: 1, actual_cost: 10, estimated_cost: 12, displayed_cost: 22 }] });
});
describe('costing selected-period reports', () => {
  it('aborts a pending overview subscriber on navigation without follow-up reads or an error toast', async () => {
    mocks.show.mockClear();
    mocks.overview.mockImplementationOnce((_params, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));
    const signal = mocks.overview.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Raw Material Prices' }));
    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(mocks.summary).not.toHaveBeenCalled(); expect(mocks.historical).not.toHaveBeenCalled();
    expect(mocks.latest).not.toHaveBeenCalled(); expect(mocks.show).not.toHaveBeenCalled();
  });
  it('passes a single live signal to the overview chain and aborts it on unmount', async () => {
    const view = render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await screen.findByTestId('historical-cost-summary');
    const signal = mocks.overview.mock.calls[0][1] as AbortSignal;
    expect(mocks.summary.mock.calls[0][1]).toBe(signal);
    expect(mocks.historical.mock.calls[0][1]).toBe(signal);
    expect(signal.aborted).toBe(false);
    view.unmount(); expect(signal.aborted).toBe(true);
  });
  it('shows completed current product costs while the sales summary is still loading',async()=>{
    let finish!:(value:unknown)=>void;
    mocks.overview.mockResolvedValue({data:[{product_id:'p',product_name:'Ready recipe',sale_price:100,actual_cost:25,recipe_item_count:1}]});
    mocks.summary.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<MemoryRouter><CostingCenterPage/></MemoryRouter>);fireEvent.click(screen.getByTestId('costing-run-report'));
    await screen.findByTestId('costing-table-panel');expect(screen.getAllByText('Ready recipe')[0]).toBeVisible();
    expect(screen.queryByTestId('historical-cost-summary')).not.toBeInTheDocument();
    finish({data:{cogs:12,net_sales:100,sales_count:1,ratio:12}});
    await screen.findByTestId('historical-cost-summary');
  });
  it('retains completed product costs but hides incomplete financial totals after a summary timeout',async()=>{
    mocks.overview.mockResolvedValue({data:[{product_id:'p',product_name:'Available recipe',sale_price:100,actual_cost:25,recipe_item_count:1}]});
    mocks.summary.mockResolvedValueOnce({error:{code:'57014',message:'canceling statement due to statement timeout'}});
    render(<MemoryRouter><CostingCenterPage/></MemoryRouter>);fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(()=>expect(screen.getByTestId('costing-report-status')).toHaveTextContent('Sales summary could not be loaded'));
    expect(screen.getAllByText('Available recipe')[0]).toBeVisible();expect(screen.queryByTestId('historical-cost-summary')).not.toBeInTheDocument();
    expect(mocks.historical).not.toHaveBeenCalled();expect(screen.getByTestId('costing-run-report')).toBeEnabled();
  });

  it('leaves tab/date navigation idle and omits unused FIFO and price reads from overview', async () => {
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    await screen.findByRole('option', { name: 'A' });
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.rawOverview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('costing-from'), { target: { value: '2026-10-01' } });
    expect(mocks.overview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await screen.findByTestId('historical-cost-summary');
    expect(mocks.overview).toHaveBeenCalledOnce();
    expect(mocks.fifo).not.toHaveBeenCalled(); expect(mocks.prices).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Raw Material Prices' }));
    expect(mocks.rawOverview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'exportExcel' })).toBeDisabled();
  });
  it('loads latest prices without stock/FIFO/history RPCs and preserves unknown prices', async () => {
    mocks.latest.mockResolvedValue([
      { raw_material_id: 'r', raw_material_name: 'Egg', raw_material_code: 'E', branch_id: 'a', latest_cost: 3.6, price_source: 'pricing', priced_at: null, reference_number: null },
      { raw_material_id: 'u', raw_material_name: 'Unknown', raw_material_code: 'U', branch_id: 'a', latest_cost: null, price_source: 'unpriced', priced_at: null, reference_number: null },
    ]);
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    await screen.findByRole('option', { name: 'A' });
    fireEvent.click(screen.getByRole('button', { name: 'Raw Material Prices' }));
    expect(mocks.latest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await screen.findByTestId('raw-latest-price-table');
    expect(mocks.latest).toHaveBeenCalledExactlyOnceWith('a');
    expect(mocks.rawOverview).not.toHaveBeenCalled();
    expect(mocks.fifo).not.toHaveBeenCalled();
    expect(mocks.historical).not.toHaveBeenCalled();
    expect(screen.getAllByText('3.6 EGP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unpriced').length).toBeGreaterThan(0);
    expect(screen.queryByText('Current inventory cost (FIFO)')).toBeNull();
  });

  it('loads accounting valuation only after its own explicit request', async () => {
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    await screen.findByRole('option', { name: 'A' });
    fireEvent.click(screen.getByRole('button', { name: 'Inventory at latest price' }));
    expect(mocks.rawOverview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await screen.findByTestId('raw-material-cost-table');
    expect(mocks.rawOverview).toHaveBeenCalledExactlyOnceWith({ p_branch_id: 'a' });
    expect(mocks.fifo).not.toHaveBeenCalled();
    expect(mocks.prices).not.toHaveBeenCalled();
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it('waits for current reads before historical pricing and avoids stale follow-up reads', async () => {
    let finish!: (value: unknown) => void;
    mocks.summary.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    expect(mocks.summary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(1));
    expect(mocks.historical).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Raw Material Prices' }));
    fireEvent.click(screen.getByTestId('costing-run-report'));
    finish({ data: { cogs: 12, net_sales: 100, sales_count: 1, ratio: 12 } });
    await waitFor(() => expect(mocks.latest).toHaveBeenCalled());
    expect(mocks.historical).not.toHaveBeenCalled();
  });

  it('supplements historical sales cost and profit without substituting stock-shortage valuation', async () => {
    mocks.historical.mockResolvedValue({ data: [{ sale_id: 'sale', estimated_cost: 8, priced_movements: 1, unpriced_movements: 0 }] });
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    expect(mocks.summary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    const summary = await screen.findByTestId('historical-cost-summary');
    await waitFor(() => expect(summary.textContent).toContain('20.00'));
    expect(summary.textContent).toContain('80.00');
    expect(summary.textContent).toContain('estimated');
  });

  it('does not present failed historical pricing as a complete zero supplement', async () => {
    mocks.historical.mockResolvedValue({ error: { message: 'Price read failed' }, data: null });
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    expect(mocks.summary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('Price read failed'), 'error', expect.objectContaining({action:'costing_historical_estimate'})));
    expect(screen.queryByTestId('historical-cost-summary')).toBeNull();
  });
  it('does not load unrelated selectors or rerun overview when branch selectors finish', async () => {
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    expect(mocks.summary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(1));
    expect(mocks.supplierOptions).not.toHaveBeenCalled();
    expect(mocks.unitOptions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Raw Material Prices' }));
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.latest).toHaveBeenCalledWith('a'));
    expect(mocks.unitOptions).not.toHaveBeenCalled();
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    expect(mocks.supplierOptions).not.toHaveBeenCalled();
  });

  it('uses applied dates for COGS summary, order margins and raw consumption cost with an inclusive end day', async () => {
    render(<MemoryRouter><CostingCenterPage /></MemoryRouter>);
    expect(mocks.summary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.summary).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('costing-from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByTestId('costing-to'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from: '2026-09-01', p_to: '2026-09-30' }, expect.any(AbortSignal)));
    fireEvent.click(screen.getByRole('button', { name: 'Period cost' }));
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.consumption).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from: '2026-08-31T21:00:00.000Z', p_to: '2026-09-30T20:59:59.999Z' }));
    expect((await screen.findAllByText('Sugar')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Latest-price cost').length).toBeGreaterThan(0);
    expect(screen.queryByText('Estimated cost')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'orderMargin' }));
    fireEvent.click(screen.getByTestId('costing-run-report'));
    await waitFor(() => expect(mocks.orders).toHaveBeenLastCalledWith({ p_branch_id: 'a', p_from: '2026-09-01', p_to: '2026-09-30' }, expect.any(AbortSignal)));
  });
});
