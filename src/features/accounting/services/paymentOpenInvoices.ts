import { supabase } from '@/api';

export type OpenReceivableInvoice = { id: string; invoice_number: string; open: number };
export type OpenPayableInvoice = OpenReceivableInvoice;
export type InvoicePage = { rows: OpenReceivableInvoice[]; hasMore: boolean };
type Params = { branchId: string; afterId?: string; isCurrent?: () => boolean };
const PAGE_SIZE = 100;

async function readInvoices(payable: boolean, partyId: string, params: Params): Promise<InvoicePage> {
  if (params.isCurrent?.() === false) throw new Error('FINANCE_SCOPE_CHANGED');
  // Security-invoker views retain base-table RLS. Filter before transferring rows;
  // never scan paid history in the browser or automatically fetch another page.
  let query = supabase.from(payable ? 'finance_open_payable_invoices' : 'finance_open_receivable_invoices')
    .select('id, invoice_number, open')
    .eq(payable ? 'supplier_id' : 'customer_id', partyId).eq('branch_id', params.branchId);
  if (params.afterId) query = query.gt('id', params.afterId);
  const { data, error } = await query.order('id', { ascending: true }).limit(PAGE_SIZE + 1);
  if (params.isCurrent?.() === false) throw new Error('FINANCE_SCOPE_CHANGED');
  if (error || !Array.isArray(data)) throw new Error('FINANCE_INVOICES_UNAVAILABLE');
  const rows = (data as unknown as OpenReceivableInvoice[]).slice(0, PAGE_SIZE).map(row => ({ ...row, open: Number(row.open) }));
  if (rows.some(row => !Number.isFinite(row.open) || row.open <= 0)) throw new Error('FINANCE_INVOICES_UNAVAILABLE');
  return { rows, hasMore: data.length > PAGE_SIZE };
}
export function fetchOpenCustomerInvoices(params: Params & { customerId: string }) {
  return readInvoices(false, params.customerId, params);
}
export function fetchOpenSupplierPurchases(params: Params & { supplierId: string }) {
  return readInvoices(true, params.supplierId, params);
}
