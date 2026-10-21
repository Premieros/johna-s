import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ branch: 'smouha', show: vi.fn(), ap: vi.fn(), ar: vi.fn(), sources: vi.fn(), pay: vi.fn(), transfer: vi.fn(), invoices: vi.fn(), audit: vi.fn(), refresh: vi.fn() }));
vi.mock('@/api', () => ({ accounting: { getApAging: mocks.ap, getArAging: mocks.ar, getAccessibleTreasuryAccounts: mocks.sources, paySupplierFromTreasury: mocks.pay, processTreasuryTransferV2: mocks.transfer, getBranchTreasuryDayCloseReconciliation: async () => ({ data: { success: true, rows: [] }, error: null }) } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor', role: 'cashier', branch_id: mocks.branch } }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true, isAdminRole: () => false }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ minIso: null }) }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: [] }) }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/hooks/usePaginatedRows', () => ({ usePaginatedRows: () => ({ rows: [], loading: false, error: null, total: 0, hasMore: false, refresh: mocks.refresh }) }));
vi.mock('@/features/accounting/services/paymentOpenInvoices', () => ({ fetchOpenSupplierPurchases: mocks.invoices, fetchOpenCustomerInvoices: mocks.invoices }));
import { PaymentsPage } from '@/features/accounting/pages/PaymentsPage';
import { TreasuryPage } from '@/features/accounting/pages/TreasuryPage';
const party = { supplier_id: 'supplier', name: 'Supplier', open_amount: 5900, bucket_0_30: 5900, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 };
const source = { id: 'cash', branch_id: 'smouha', account_name: 'Branch Cash', branch_name: 'Smouha', kind: 'branch_cash', scope: 'branch', account_type: 'cash', balance: 10000 };
function app(page: 'payments' | 'treasury' = 'payments') { return <MemoryRouter initialEntries={['/payments?tab=ap']}>{page === 'payments' ? <PaymentsPage /> : <TreasuryPage />}</MemoryRouter>; }
async function openPayment() {
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'paySupplier' })[0]).toBeEnabled());
  fireEvent.click(screen.getAllByRole('button', { name: 'paySupplier' })[0]);
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'paySupplier' })).toBeEnabled());
  return within(dialog);
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.branch = 'smouha';
  mocks.ap.mockResolvedValue({ data: [party], error: null }); mocks.ar.mockResolvedValue({ data: [], error: null });
  mocks.sources.mockResolvedValue({ data: [source, { ...source, id: 'main', scope: 'organization', kind: 'main_cash', account_name: 'Main' }], error: null });
  mocks.invoices.mockResolvedValue([{ id: 'invoice', invoice_number: 'INV', open: 3500 }]);
  mocks.pay.mockResolvedValue({ data: { success: true, reference_number: 'PAY-1' }, error: null });
  mocks.transfer.mockResolvedValue({ data: { success: false, error: 'INSUFFICIENT_TREASURY_BALANCE', available: 50 }, error: null });
});
describe('finance payment root regressions', () => {
  it('uses the selected invoice balance and refuses an overpayment before any mutation', async () => {
    render(app()); const dialog = await openPayment();
    fireEvent.change(dialog.getByLabelText('invoice'), { target: { value: 'invoice' } });
    expect(dialog.getByLabelText('amount')).toHaveValue(3500);
    fireEvent.change(dialog.getByLabelText('amount'), { target: { value: '5900' } });
    fireEvent.click(dialog.getByRole('button', { name: 'paySupplier' }));
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('selected invoice'), 'error');
  });
  it('blocks payment on invoice read failure instead of treating it as no invoices', async () => {
    mocks.invoices.mockRejectedValue(new Error('FINANCE_INVOICES_UNAVAILABLE'));
    render(app());
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'paySupplier' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: 'paySupplier' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Outstanding invoices could not be loaded');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'paySupplier' })).toBeDisabled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('keeps a successful supplier payment in its submitted branch without duplicating the server audit', async () => {
    let resolve!: (result: unknown) => void;
    mocks.pay.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const view = render(app()); const dialog = await openPayment();
    fireEvent.click(dialog.getByRole('button', { name: 'paySupplier' }));
    mocks.branch = 'cleopatra'; view.rerender(app());
    await act(async () => { resolve({ data: { success: true }, error: null }); });
    expect(mocks.pay).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ p_branch_id: 'smouha' }));
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('does not retry an ambiguous payment or describe it as rolled back', async () => {
    mocks.pay.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(app()); const dialog = await openPayment();
    fireEvent.click(dialog.getByRole('button', { name: 'paySupplier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outcome could not be confirmed');
    expect(dialog.getByRole('button', { name: 'paySupplier' })).toBeDisabled();
    expect(mocks.pay).toHaveBeenCalledTimes(1);
  });
  it('ignores an old branch aging response after the new branch has loaded', async () => {
    let resolve!: (result: unknown) => void;
    mocks.ap.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const view = render(app());
    mocks.branch = 'cleopatra'; mocks.ap.mockResolvedValue({ data: [{ ...party, name: 'Cleopatra supplier' }], error: null });
    view.rerender(app()); await screen.findAllByText('Cleopatra supplier');
    await act(async () => { resolve({ data: [{ ...party, name: 'Old supplier' }], error: null }); });
    expect(screen.queryByText('Old supplier')).not.toBeInTheDocument();
  });
  it('refreshes only balance reads on a rejected transfer and never repeats the financial write', async () => {
    render(app('treasury'));
    fireEvent.click(screen.getByRole('button', { name: 'transfer' }));
    // The first click may precede the initial read; open after the balance is ready.
    await screen.findByRole('cell', { name: 'Branch Cash' });
    if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'transfer' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('fromAccount'), { target: { value: 'cash' } });
    fireEvent.change(dialog.getByLabelText('toAccount'), { target: { value: 'main' } });
    fireEvent.change(dialog.getByLabelText('amount'), { target: { value: '100' } });
    fireEvent.click(dialog.getByRole('button', { name: 'transfer' }));
    await waitFor(() => expect(mocks.sources).toHaveBeenCalledTimes(2));
    expect(mocks.transfer).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('Available now'), 'error', expect.objectContaining({ source: expect.objectContaining({ available: 50 }) }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
