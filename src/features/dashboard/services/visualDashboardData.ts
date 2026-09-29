import { supabase } from '@/api';

export async function loadVisualDashboardCore(params: {
  branchId: string | null;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  wasteFrom: string;
  wasteTo: string;
}): Promise<{
  sales: unknown[];
  previousSales: unknown[];
  inventory: unknown[];
  items: unknown[];
  wasteRows: unknown[];
}> {
  const saleFields = 'id,invoice_number,total,paid_amount,payment_method,status,branch_id,created_at,order_type,refunded_amount,discount_amount,branch:branches(name,name_en)';
  let currentQuery = supabase
    .from('sales')
    .select(saleFields)
    .gte('created_at', params.currentFrom)
    .lte('created_at', params.currentTo)
    .order('created_at', { ascending: false })
    .limit(5000);
  let previousQuery = supabase
    .from('sales')
    .select(saleFields)
    .gte('created_at', params.previousFrom)
    .lt('created_at', params.previousTo)
    .limit(5000);
  let inventoryQuery = supabase
    .from('inventory')
    .select('quantity,product:products(name,low_stock_threshold)')
    .limit(5000);

  if (params.branchId) {
    currentQuery = currentQuery.eq('branch_id', params.branchId);
    previousQuery = previousQuery.eq('branch_id', params.branchId);
    inventoryQuery = inventoryQuery.eq('branch_id', params.branchId);
  }

  const [currentResult, previousResult, inventoryResult] = await Promise.all([
    currentQuery,
    previousQuery,
    inventoryQuery,
  ]);
  if (currentResult.error) throw currentResult.error;
  if (previousResult.error) throw previousResult.error;
  if (inventoryResult.error) throw inventoryResult.error;

  const sales = currentResult.data || [];
  let items: unknown[] = [];
  if (sales.length) {
    const itemResult = await supabase
      .from('sale_items')
      .select('quantity,refunded_quantity,product:products(name)')
      .in('sale_id', sales.map((row) => row.id))
      .limit(10000);
    items = itemResult.error ? [] : (itemResult.data || []);
  }

  const wasteResult = await supabase.rpc('get_waste_report', {
    p_branch_id: params.branchId,
    p_from_date: params.wasteFrom,
    p_to_date: params.wasteTo,
  });

  return {
    sales,
    previousSales: previousResult.data || [],
    inventory: inventoryResult.data || [],
    items,
    wasteRows: wasteResult.error ? [] : (wasteResult.data || []),
  };
}

export async function loadVisualDashboardMonthlyRows(params: {
  branchId: string | null;
  monthStart: string;
  monthEnd: string;
}): Promise<{
  sales: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
}> {
  let salesQuery = supabase
    .from('sales')
    .select('total,refunded_amount')
    .gte('created_at', params.monthStart)
    .lte('created_at', params.monthEnd);
  let inventoryQuery = supabase
    .from('inventory')
    .select('quantity, product:products(low_stock_threshold)');

  if (params.branchId) {
    salesQuery = salesQuery.eq('branch_id', params.branchId);
    inventoryQuery = inventoryQuery.eq('branch_id', params.branchId);
  }

  const [salesResult, inventoryResult] = await Promise.all([salesQuery, inventoryQuery]);

  return {
    sales: (salesResult.data || []) as Record<string, unknown>[],
    inventory: (inventoryResult.data || []) as Record<string, unknown>[],
  };
}
