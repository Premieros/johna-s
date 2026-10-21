import { supabase } from '@/api';

export type OpenReceivableInvoice = { id: string; invoice_number: string; open: number };
export type OpenPayableInvoice = OpenReceivableInvoice;
type Params = { branchId: string; isCurrent?: () => boolean };
type InvoiceRow = { id: string; invoice_number: string; total: number; paid_amount: number; refunded_amount?: number | null; returned_amount?: number | null };
const PAGE_SIZE = 500;
const MAX_SOURCE_ROWS = 5000;

async function readInvoices(table: 'sales' | 'purchases', partyId: string, params: Params): Promise<OpenPayableInvoice[]> {
  const payable = table === 'purchases';
  const rows: OpenPayableInvoice[] = [];
  // Deterministic, narrow party + branch pages. Never return a truncated/failed list.
  for (let offset = 0; offset < MAX_SOURCE_ROWS; offset += PAGE_SIZE) {
    if (params.isCurrent?.() === false) throw new Error('FINANCE_SCOPE_CHANGED');
    let query = supabase.from(table)
      .select(`id, invoice_number, total, paid_amount, ${payable ? 'returned_amount' : 'refunded_amount'}`)
      .eq(payable ? 'supplier_id' : 'customer_id', partyId)
      .eq('branch_id', params.branchId).gt('total', 0);
    query = payable ? query.eq('status', 'completed') : query.neq('status', 'returned');
    const { data, error } = await query.order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (params.isCurrent?.() === false) throw new Error('FINANCE_SCOPE_CHANGED');
    if (error || !Array.isArray(data)) throw new Error('FINANCE_INVOICES_UNAVAILABLE');
    for (const row of data as unknown as InvoiceRow[]) {
      const open = Number(row.total) - Number(row.paid_amount) - Number((payable ? row.returned_amount : row.refunded_amount) || 0);
      if (!Number.isFinite(open)) throw new Error('FINANCE_INVOICES_UNAVAILABLE');
      if (open > 0) rows.push({ id: row.id, invoice_number: row.invoice_number, open });
    }
    if (data.length < PAGE_SIZE) return rows;
  }
  throw new Error('FINANCE_INVOICE_LIMIT');
}

export function fetchOpenCustomerInvoices(params: Params & { customerId: string }) {
  return readInvoices('sales', params.customerId, params);
}
export function fetchOpenSupplierPurchases(params: Params & { supplierId: string }) {
  return readInvoices('purchases', params.supplierId, params);
}
