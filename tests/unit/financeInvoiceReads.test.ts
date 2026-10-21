import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ page: vi.fn(), filters: vi.fn(), table: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { from: (table: string) => {
  mocks.table(table);
  const q = { select: () => q, eq: (...args: unknown[]) => { mocks.filters(...args); return q; }, gt: () => q, neq: () => q, order: () => q, range: mocks.page };
  return q;
} } }));
import { fetchOpenCustomerInvoices, fetchOpenSupplierPurchases } from '@/features/accounting/services/paymentOpenInvoices';
const paid = { id: 'paid', invoice_number: 'OLD', total: 10, paid_amount: 10, returned_amount: 0 };
beforeEach(() => { vi.clearAllMocks(); });
describe('complete bounded party invoice reads', () => {
  it('finds an unpaid invoice after a full paid-history page without widening party/branch', async () => {
    mocks.page.mockResolvedValueOnce({ data: Array.from({length: 500}, (_, i) => ({ ...paid, id: String(i) })), error: null })
      .mockResolvedValueOnce({ data: [{ ...paid, id: 'due', total: 3500, paid_amount: 0 }], error: null });
    expect(await fetchOpenSupplierPurchases({ supplierId: 'supplier', branchId: 'smouha' })).toEqual([{ id: 'due', invoice_number: 'OLD', open: 3500 }]);
    expect(mocks.page.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(mocks.filters).toHaveBeenCalledWith('supplier_id', 'supplier');
    expect(mocks.filters).toHaveBeenCalledWith('branch_id', 'smouha');
  });
  it('never turns a failed later page into a partial invoice list', async () => {
    mocks.page.mockResolvedValueOnce({ data: Array.from({length: 500}, () => ({...paid, paid_amount: 0})), error: null })
      .mockResolvedValueOnce({ data: null, error: {code: '57014'} });
    await expect(fetchOpenSupplierPurchases({ supplierId: 'supplier', branchId: 'branch' })).rejects.toThrow('FINANCE_INVOICES_UNAVAILABLE');
  });
  it('stops stale branch reads before another page', async () => {
    let current = true;
    mocks.page.mockImplementationOnce(async () => { current = false; return { data: Array(500).fill(paid), error: null }; });
    await expect(fetchOpenCustomerInvoices({ customerId: 'customer', branchId: 'old', isCurrent: () => current })).rejects.toThrow('FINANCE_SCOPE_CHANGED');
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });
  it('rejects the source cap instead of presenting a complete-looking truncated list', async () => {
    mocks.page.mockResolvedValue({ data: Array(500).fill(paid), error: null });
    await expect(fetchOpenSupplierPurchases({ supplierId: 'supplier', branchId: 'branch' })).rejects.toThrow('FINANCE_INVOICE_LIMIT');
    expect(mocks.page).toHaveBeenCalledTimes(10);
  });
});
