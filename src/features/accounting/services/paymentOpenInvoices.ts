import { supabase } from '@/api';

export type OpenReceivableInvoice = {
  id: string;
  invoice_number: string;
  open: number;
};

export type OpenPayableInvoice = {
  id: string;
  invoice_number: string;
  open: number;
};

export async function fetchOpenCustomerInvoices(params: {
  customerId: string;
  branchId: string;
}): Promise<OpenReceivableInvoice[]> {
  const { data } = await supabase
    .from('sales')
    .select('id, invoice_number, total, paid_amount, refunded_amount')
    .eq('customer_id', params.customerId)
    .eq('branch_id', params.branchId)
    .neq('status', 'returned')
    .order('created_at', { ascending: true });

  return ((data as Array<{
    id: string;
    invoice_number: string;
    total: number;
    paid_amount: number;
    refunded_amount: number | null;
  }> | null) || [])
    .map((sale) => ({
      id: sale.id,
      invoice_number: sale.invoice_number,
      open: Number(sale.total) - Number(sale.paid_amount) - Number(sale.refunded_amount || 0),
    }))
    .filter((sale) => sale.open > 0);
}

export async function fetchOpenSupplierPurchases(params: {
  supplierId: string;
  branchId: string;
}): Promise<OpenPayableInvoice[]> {
  const { data } = await supabase
    .from('purchases')
    .select('id, invoice_number, total, paid_amount, returned_amount')
    .eq('supplier_id', params.supplierId)
    .eq('branch_id', params.branchId)
    .eq('status', 'completed')
    .order('created_at', { ascending: true });

  return ((data as Array<{
    id: string;
    invoice_number: string;
    total: number;
    paid_amount: number;
    returned_amount: number | null;
  }> | null) || [])
    .map((purchase) => ({
      id: purchase.id,
      invoice_number: purchase.invoice_number,
      open: Number(purchase.total) - Number(purchase.paid_amount) - Number(purchase.returned_amount || 0),
    }))
    .filter((purchase) => purchase.open > 0);
}
