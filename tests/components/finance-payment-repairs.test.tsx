import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ branch: 'smouha', denied: new Set<string>(), show: vi.fn(), ap: vi.fn(), ar: vi.fn(), sources: vi.fn(), pay: vi.fn(), collect: vi.fn(), transfer: vi.fn(), invoices: vi.fn(), audit: vi.fn(), refresh: vi.fn() }));
vi.mock('@/api', () => ({ accounting: { receivePayment: mocks.collect, getApAging: mocks.ap, getArAging: mocks.ar, getAccessibleTreasuryAccounts: mocks.sources, paySupplierFromTreasury: mocks.pay, processTreasuryTransferV2: mocks.transfer, getBranchTreasuryDayCloseReconciliation: async () => ({ data: { success: true, rows: [] }, error: null }) } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: mocks.show }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor', role: 'cashier', branch_id: mocks.branch } }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => (permission: string) => !mocks.denied.has(permission), isAdminRole: () => false }));
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
function app(page: 'payments' | 'treasury' | 'ar' = 'payments') { return <MemoryRouter initialEntries={[page === 'ar' ? '/payments?tab=ar' : '/payments?tab=ap']}>{page !== 'treasury' ? <PaymentsPage /> : <TreasuryPage />}</MemoryRouter>; }
async function openPayment() {
  await waitFor(() => expect(within(screen.getByTestId('payments-ap-aging-panel')).getAllByText('paySupplier', { selector: 'button' })[0]).toBeEnabled());
  fireEvent.click(within(screen.getByTestId('payments-ap-aging-panel')).getAllByText('paySupplier', { selector: 'button' })[0]);
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'paySupplier' })).toBeEnabled());
  return within(dialog);
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.branch = 'smouha'; mocks.denied.clear();
  mocks.ap.mockResolvedValue({ data: [party], error: null }); mocks.ar.mockResolvedValue({ data: [], error: null });
  mocks.sources.mockResolvedValue({ data: [source, { ...source, id: 'main', scope: 'organization', kind: 'main_cash', account_name: 'Main' }], error: null });
  mocks.invoices.mockResolvedValue({ rows: [{ id: 'invoice', invoice_number: 'INV', open: 3500 }], hasMore: false });
  mocks.pay.mockResolvedValue({ data: { success: true, reference_number: 'PAY-1' }, error: null });
  mocks.transfer.mockResolvedValue({ data: { success: false, error: 'INSUFFICIENT_TREASURY_BALANCE', available: 50 }, error: null });
});
describe('finance payment root regressions', () => {
  it('keeps supplier balances readable but hides payment actions from view-only users', async () => {
    mocks.denied.add('procurement.payment.create');
    render(app());
    await screen.findAllByText('Supplier');
    expect(within(screen.getByTestId('payments-ap-aging-panel')).queryByRole('button', {name:'paySupplier'})).toBeNull();
    expect(mocks.invoices).not.toHaveBeenCalled();expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('closes a supplier-payment dialog when its independent action permission is revoked', async () => {
    const view=render(app());await openPayment();
    mocks.denied.add('procurement.payment.create');view.rerender(app());
    expect(screen.queryByRole('dialog')).toBeNull();expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('does not turn account management or POS payment permission into customer collection', async () => {
    mocks.denied.add('sales.payment.receive');
    mocks.ar.mockResolvedValue({data:[{...party,customer_id:'customer'}],error:null});
    render(app('ar'));await screen.findAllByText('Supplier');
    expect(within(screen.getByTestId('payments-ar-aging-panel')).queryByRole('button',{name:'collect'})).toBeNull();
    expect(mocks.collect).not.toHaveBeenCalled();expect(mocks.invoices).not.toHaveBeenCalled();
  });
  it('keeps treasury viewing separate from deposit, withdrawal and transfer actions', async () => {
    mocks.denied.add('accounts.manage');mocks.denied.add('accounting.treasury.transfer');
    render(app('treasury'));
    await waitFor(()=>expect(mocks.sources).toHaveBeenCalled());
    expect(screen.queryByRole('button',{name:'deposit'})).toBeNull();expect(screen.queryByRole('button',{name:'withdrawal'})).toBeNull();expect(screen.queryByRole('button',{name:'transfer'})).toBeNull();
    expect(mocks.transfer).not.toHaveBeenCalled();
  });
  it('loads further invoices only on request and keeps earlier selections available', async () => {
    mocks.invoices.mockResolvedValueOnce({rows:[{id:'invoice',invoice_number:'INV',open:3500}],hasMore:true})
      .mockResolvedValueOnce({rows:[{id:'next',invoice_number:'NEXT',open:50}],hasMore:false});
    render(app()); const dialog = await openPayment();
    expect(mocks.invoices).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.getByText('Load more invoices', {selector:'button'}));
    await waitFor(() => expect(dialog.getByText(/NEXT -/)).toBeInTheDocument());
    expect(mocks.invoices).toHaveBeenLastCalledWith(expect.objectContaining({afterId:'invoice',branchId:'smouha'}));
    expect(dialog.getByText(/INV -/)).toBeInTheDocument();
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('uses rejected customer invoice open amount without an extra read or mutation retry', async () => {
    mocks.ar.mockResolvedValue({data:[{...party,customer_id:'customer'}],error:null});
    mocks.collect.mockResolvedValue({data:{success:false,error:'PAYMENT_EXCEEDS_INVOICE',open:20},error:null});
    render(app('ar'));
    const panel = await screen.findByTestId('payments-ar-aging-panel');
    await waitFor(() => expect(within(panel).getAllByText('collect',{selector:'button'})[0]).toBeEnabled());
    fireEvent.click(within(panel).getAllByText('collect',{selector:'button'})[0]);
    const dialog=within(screen.getByRole('dialog'));
    await waitFor(() => expect(dialog.getByLabelText('invoice')).toBeInTheDocument());
    fireEvent.change(dialog.getByLabelText('invoice'),{target:{value:'invoice'}});
    fireEvent.click(dialog.getByText('collect',{selector:'button'}));
    await waitFor(() => expect(mocks.show).toHaveBeenCalled());
    fireEvent.change(dialog.getByLabelText('invoice'),{target:{value:''}});
    fireEvent.change(dialog.getByLabelText('invoice'),{target:{value:'invoice'}});
    expect(dialog.getByLabelText('amount')).toHaveValue(20);
    expect(mocks.invoices).toHaveBeenCalledTimes(1); expect(mocks.collect).toHaveBeenCalledTimes(1);
  });
  it('uses the selected invoice balance and refuses an overpayment before any mutation', async () => {
    render(app()); const dialog = await openPayment();
    fireEvent.change(dialog.getByLabelText('invoice'), { target: { value: 'invoice' } });
    expect(dialog.getByLabelText('amount')).toHaveValue(3500);
    fireEvent.change(dialog.getByLabelText('amount'), { target: { value: '5900' } });
    fireEvent.click(dialog.getByText('paySupplier', { selector: 'button' }));
    expect(mocks.pay).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining('selected invoice'), 'error');
  });
  it('blocks payment on invoice read failure instead of treating it as no invoices', async () => {
    mocks.invoices.mockRejectedValue(new Error('FINANCE_INVOICES_UNAVAILABLE'));
    render(app());
    await waitFor(() => expect(within(screen.getByTestId('payments-ap-aging-panel')).getAllByText('paySupplier', { selector: 'button' })[0]).toBeEnabled());
    fireEvent.click(within(screen.getByTestId('payments-ap-aging-panel')).getAllByText('paySupplier', { selector: 'button' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Outstanding invoices could not be loaded');
    expect(within(screen.getByRole('dialog')).getByText('paySupplier', { selector: 'button' })).toBeDisabled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it('keeps a successful supplier payment in its submitted branch without duplicating the server audit', async () => {
    let resolve!: (result: unknown) => void;
    mocks.pay.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const view = render(app()); const dialog = await openPayment();
    fireEvent.click(dialog.getByText('paySupplier', { selector: 'button' }));
    mocks.branch = 'cleopatra'; view.rerender(app());
    await act(async () => { resolve({ data: { success: true }, error: null }); });
    expect(mocks.pay).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ p_branch_id: 'smouha' }));
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('does not retry an ambiguous payment or describe it as rolled back', async () => {
    mocks.pay.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(app()); const dialog = await openPayment();
    fireEvent.click(dialog.getByText('paySupplier', { selector: 'button' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outcome could not be confirmed');
    expect(dialog.getByText('paySupplier', { selector: 'button' })).toBeDisabled();
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
