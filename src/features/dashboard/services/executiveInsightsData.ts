import { supabase } from '@/api';
import type { SalePaymentLike } from '@/features/reporting/numericIntegrity';

export type ExecutiveInsightSale = {
  id: string;
  total: number | null;
  paid_amount: number | null;
  refunded_amount: number | null;
  payment_method: string | null;
  order_type: string | null;
  branch_id: string | null;
  created_at: string;
};

export type ExecutiveInsightStock = {
  quantity: number | null;
  branch_id: string | null;
  product: { low_stock_threshold: number | null }[] | null;
};

export async function loadExecutiveInsightsData(params: {
  branchId: string | null;
  startIso: string;
  endIso: string;
}): Promise<{
  sales: ExecutiveInsightSale[];
  salePayments: SalePaymentLike[];
  stock: ExecutiveInsightStock[];
}> {
  let salesQuery = supabase
    .from('sales')
    .select('id,total,paid_amount,refunded_amount,payment_method,order_type,branch_id,created_at')
    .gte('created_at', params.startIso)
    .lte('created_at', params.endIso)
    .order('created_at', { ascending: false })
    .limit(5000);

  let inventoryQuery = supabase
    .from('inventory')
    .select('quantity,branch_id,product:products(low_stock_threshold)')
    .limit(5000);

  if (params.branchId) {
    salesQuery = salesQuery.eq('branch_id', params.branchId);
    inventoryQuery = inventoryQuery.eq('branch_id', params.branchId);
  }

  const [salesResult, inventoryResult] = await Promise.all([salesQuery, inventoryQuery]);
  if (salesResult.error) throw salesResult.error;
  if (inventoryResult.error) throw inventoryResult.error;

  const sales = (salesResult.data || []) as ExecutiveInsightSale[];
  const stock = (inventoryResult.data || []) as unknown as ExecutiveInsightStock[];

  if (sales.length === 0) {
    return { sales, stock, salePayments: [] };
  }

  const paymentResult = await supabase
    .from('sale_payments')
    .select('sale_id,branch_id,payment_method,amount,refunded_amount')
    .in('sale_id', sales.map((sale) => sale.id))
    .limit(10000);

  return {
    sales,
    stock,
    salePayments: paymentResult.error ? [] : ((paymentResult.data || []) as SalePaymentLike[]),
  };
}
