import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ page: vi.fn(), filters: vi.fn(), table: vi.fn(), order: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { from: (table: string) => {
  mocks.table(table);
  const q = { select: () => q, eq: (...args: unknown[]) => { mocks.filters(...args); return q; }, gt: (...args: unknown[]) => { mocks.filters(...args); return q; }, order: (...args: unknown[]) => { mocks.order(...args); return q; }, limit: mocks.page };
  return q;
} } }));
import { fetchOpenCustomerInvoices, fetchOpenSupplierPurchases } from '@/features/accounting/services/paymentOpenInvoices';
beforeEach(() => { vi.clearAllMocks(); });
describe('manual outstanding invoice pages', () => {
  it('reads only the outstanding projection, one bounded request and no paid-history loop', async () => {
    mocks.page.mockResolvedValue({ data: Array.from({length:101}, (_, i) => ({ id: String(i), invoice_number:'INV', open:'3500' })), error:null });
    const page = await fetchOpenSupplierPurchases({ supplierId:'supplier', branchId:'branch' });
    expect(page.rows).toHaveLength(100); expect(page.hasMore).toBe(true); expect(page.rows[0].open).toBe(3500);
    expect(mocks.table).toHaveBeenCalledWith('finance_open_payable_invoices');
    expect(mocks.page).toHaveBeenCalledExactlyOnceWith(101);
    expect(mocks.filters.mock.calls).toEqual([['supplier_id','supplier'],['branch_id','branch']]);
  });
  it('uses a cursor rather than an offset for the next requested page', async () => {
    mocks.page.mockResolvedValue({ data:[{id:'next',invoice_number:'NEXT',open:10}],error:null });
    const page = await fetchOpenCustomerInvoices({ customerId:'customer',branchId:'branch',afterId:'last' });
    expect(page.hasMore).toBe(false); expect(mocks.filters).toHaveBeenCalledWith('id','last');
    expect(mocks.table).toHaveBeenCalledWith('finance_open_receivable_invoices');
  });
  it('does not present a failed page as empty or complete', async () => {
    mocks.page.mockResolvedValue({ data:null,error:{code:'57014'} });
    await expect(fetchOpenSupplierPurchases({supplierId:'s',branchId:'b'})).rejects.toThrow('FINANCE_INVOICES_UNAVAILABLE');
  });
  it('discards a response after a branch change', async () => {
    let current=true;
    mocks.page.mockImplementation(async () => { current=false; return { data:[],error:null }; });
    await expect(fetchOpenCustomerInvoices({customerId:'c',branchId:'b',isCurrent:()=>current})).rejects.toThrow('FINANCE_SCOPE_CHANGED');
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });
});
