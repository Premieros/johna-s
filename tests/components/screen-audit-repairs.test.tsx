import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RawMaterialsPage } from '@/features/manufacturing/pages/RawMaterialsPage';
import { LowStockAlertsPage } from '@/features/inventory/pages/LowStockAlertsPage';
import { ProcurementCenterPage } from '@/features/trade/pages/ProcurementCenterPage';
import { PaymentsPage } from '@/features/accounting/pages/PaymentsPage';

const mocks = vi.hoisted(() => ({
  t: (key: string) => key, branch: 'smouha', show: vi.fn(), pages: vi.fn(), alerts: vi.fn(), summary: vi.fn(),
  ap: vi.fn(), ar: vi.fn(), meta: vi.fn(),
}));
vi.mock('@/api', () => ({ inventory: { getLowStockAlerts: mocks.alerts, getLowStockSummary: mocks.summary }, accounting: { getApAging: mocks.ap, getArAging: mocks.ar, getAccessibleTreasuryAccounts: async () => ({ data: [], error: null }) } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: mocks.t }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => false }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', branch_id: mocks.branch } }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ minIso: null }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/hooks/usePaginatedRows', () => ({ usePaginatedRows: mocks.pages }));
vi.mock('@/features/manufacturing/services/rawMaterialData', () => ({ loadRawMaterialMeta: mocks.meta, updateRawMaterial: vi.fn(), deleteRawMaterial: vi.fn() }));
vi.mock('@/features/inventory/services/lowStockData', () => ({
  loadLowStockOptions: async () => ({ branches: [{ id: mocks.branch, name: mocks.branch }], warehouses: [], suppliers: [], branchError: null }),
  loadProductCostMap: vi.fn(), loadRawMaterialReorderRows: vi.fn(),
}));
const material = { id: 'beyond-first-page', name: 'لحم مفروم', code: 'MEAT', category: null, unit_id: 'kg', branch_id: 'smouha', is_active: true, min_stock: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.branch = 'smouha';
  mocks.pages.mockReturnValue({ rows: [], loading: false, error: null, total: 0, hasMore: false, loadMore: vi.fn(), refresh: vi.fn() });
  mocks.meta.mockResolvedValue({ inventory: [], batches: [], currentPrices: [], units: [], branches: [] });
  mocks.alerts.mockResolvedValue({ data: [
    { product_id: 'a', product_name: 'Out 1', status: 'out', quantity: -1 },
    { product_id: 'b', product_name: 'Out 2', status: 'out', quantity: 0 },
    { product_id: 'c', product_name: 'Low 1', status: 'low', quantity: 1 },
    { product_id: 'd', product_name: 'Ok 1', status: 'ok', quantity: 10 },
  ], error: null });
  mocks.ap.mockResolvedValue({ data: [{ supplier_id: 's', supplier_name: 'Supplier', open_amount: 12, bucket_0_30: 0, bucket_31_60: 12, bucket_61_90: 0, bucket_90_plus: 0 }], error: null });
  mocks.ar.mockResolvedValue({ data: [], error: null });
});
describe('audited screen regressions', () => {
  it.each(['smouha', 'cleopatra'])('sends name/code/category search to bounded server paging in %s', async branch => {
    mocks.branch = branch;
    mocks.pages.mockImplementation(options => ({ rows: options.search?.term === 'لحم مفروم' ? [material] : [], loading: false, error: null, total: null, hasMore: false, loadMore: vi.fn(), refresh: vi.fn() }));
    render(<MemoryRouter><RawMaterialsPage /></MemoryRouter>);
    await waitFor(() => expect(mocks.meta).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('raw-materials-search'), { target: { value: 'لحم مفروم' } });
    await waitFor(() => expect(screen.getByRole('cell', { name: /لحم مفروم/ })).toBeVisible());
    expect(mocks.pages).toHaveBeenLastCalledWith(expect.objectContaining({ table: 'raw_materials', branch_id: branch, pageSize: 100, search: { term: 'لحم مفروم', columns: ['name', 'code', 'category'] } }));
  });
  it('counts all canonical alert rows without a duplicate summary read or search-dependent counters', async () => {
    render(<MemoryRouter><LowStockAlertsPage /></MemoryRouter>);
    await screen.findAllByText('Out 1');
    const label = screen.getByText('statusOut', { selector: 'p' });
    expect(within(label.parentElement!).getByText('2')).toBeVisible();
    fireEvent.change(screen.getByTestId('alerts-search'), { target: { value: 'Low 1' } });
    expect(screen.queryAllByText('Out 1')).toHaveLength(0);
    expect(within(label.parentElement!).getByText('2')).toBeVisible();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.alerts).toHaveBeenCalledWith({ p_branch_id: 'smouha', p_warehouse_id: null });
  });
  it('refreshes alert rows and counters for the globally selected branch', async () => {
    const view = render(<MemoryRouter><LowStockAlertsPage /></MemoryRouter>);
    await screen.findAllByText('Out 1');
    mocks.alerts.mockResolvedValue({ data: [{ product_id: 'other', product_name: 'Cleopatra only', status: 'low', quantity: 1 }], error: null });
    mocks.branch = 'cleopatra';
    view.rerender(<MemoryRouter><LowStockAlertsPage /></MemoryRouter>);
    await screen.findAllByText('Cleopatra only');
    expect(mocks.alerts).toHaveBeenLastCalledWith({ p_branch_id: 'cleopatra', p_warehouse_id: null });
    expect(screen.queryAllByText('Out 1')).toHaveLength(0);
    const label = screen.getByText('statusOut', { selector: 'p' });
    expect(within(label.parentElement!).getByText('0')).toBeVisible();
  });
  it('opens supplier payments from procurement without first requesting customer aging', async () => {
    render(<MemoryRouter initialEntries={['/procurement-center']}><Routes>
      <Route path="/procurement-center" element={<ProcurementCenterPage />} />
      <Route path="/payments" element={<PaymentsPage />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByTestId('procurement-center-payables'));
    await waitFor(() => expect(mocks.ap).toHaveBeenCalled());
    expect(mocks.ar).not.toHaveBeenCalled();
    expect(screen.getByText('days60', { selector: 'p' })).toBeVisible();
    const bucket = screen.getByText('days60', { selector: 'p' }).parentElement!;
    expect(within(bucket).getByText(/12/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'customerPayments' }));
    await waitFor(() => expect(mocks.ar).toHaveBeenCalled());
  });
});
