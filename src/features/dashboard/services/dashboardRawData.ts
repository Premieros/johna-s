import { supabase } from '@/api';

export async function loadDashboardFallbackSales(params: {
  branchId: string | null;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
}): Promise<{
  currentRows: unknown[];
  previousRows: unknown[];
  itemRows: unknown[];
  currentErrorMessage: string | null;
}> {
  const fields = 'id,invoice_number,total,paid_amount,payment_method,status,branch_id,created_at,order_type,refunded_amount,discount_amount,branch:branches(name,name_en)';
  const previousFields = 'id,total,paid_amount,payment_method,branch_id,created_at,refunded_amount,discount_amount';

  let currentQuery = supabase
    .from('sales')
    .select(fields)
    .gte('created_at', params.currentFrom)
    .lte('created_at', params.currentTo)
    .order('created_at', { ascending: false })
    .limit(5000);
  let previousQuery = supabase
    .from('sales')
    .select(previousFields)
    .gte('created_at', params.previousFrom)
    .lte('created_at', params.previousTo)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (params.branchId) {
    currentQuery = currentQuery.eq('branch_id', params.branchId);
    previousQuery = previousQuery.eq('branch_id', params.branchId);
  }

  const [currentResult, previousResult] = await Promise.all([currentQuery, previousQuery]);
  const currentRows = currentResult.error ? [] : (currentResult.data || []);
  const previousRows = previousResult.error ? [] : (previousResult.data || []);

  let itemRows: unknown[] = [];
  if (currentRows.length) {
    let itemQuery = supabase
      .from('sale_items')
      .select('quantity,refunded_quantity,product:products(name),sale:sales!inner(created_at,branch_id)')
      .gte('sale.created_at', params.currentFrom)
      .lte('sale.created_at', params.currentTo)
      .limit(5000);
    if (params.branchId) itemQuery = itemQuery.eq('sale.branch_id', params.branchId);
    const itemResult = await itemQuery;
    itemRows = itemResult.error ? [] : (itemResult.data || []);
  }

  return {
    currentRows,
    previousRows,
    itemRows,
    currentErrorMessage: currentResult.error?.message || null,
  };
}

export async function loadDashboardStockRows(params: {
  enabled: boolean;
  branchId: string | null;
}): Promise<{
  rawMasters: unknown[];
  rawBalances: unknown[];
  unitMasters: unknown[];
  unitBatches: unknown[];
  failed: boolean;
}> {
  if (!params.enabled) {
    return { rawMasters: [], rawBalances: [], unitMasters: [], unitBatches: [], failed: true };
  }

  let rawMasterQuery = supabase.from('raw_materials').select('id,branch_id,name,min_stock,is_active').eq('is_active', true);
  let rawBalanceQuery = supabase.from('raw_material_inventory').select('raw_material_id,branch_id,quantity');
  let unitMasterQuery = supabase.from('inventory_units').select('id,branch_id,name,min_stock,low_stock_threshold,is_active').eq('is_active', true);
  let unitBatchQuery = supabase.from('inventory_unit_batches').select('unit_id,branch_id,quantity');

  if (params.branchId) {
    rawMasterQuery = rawMasterQuery.eq('branch_id', params.branchId);
    rawBalanceQuery = rawBalanceQuery.eq('branch_id', params.branchId);
    unitMasterQuery = unitMasterQuery.eq('branch_id', params.branchId);
    unitBatchQuery = unitBatchQuery.eq('branch_id', params.branchId);
  }

  const [rawMastersResult, rawBalancesResult, unitMastersResult, unitBatchesResult] = await Promise.all([
    rawMasterQuery,
    rawBalanceQuery,
    unitMasterQuery,
    unitBatchQuery,
  ]);

  return {
    rawMasters: rawMastersResult.data || [],
    rawBalances: rawBalancesResult.data || [],
    unitMasters: unitMastersResult.data || [],
    unitBatches: unitBatchesResult.data || [],
    failed: Boolean(rawMastersResult.error || rawBalancesResult.error || unitMastersResult.error || unitBatchesResult.error),
  };
}

export async function loadDashboardOpsRows(params: {
  branchId: string | null;
  fromIso: string;
  fromDate: string;
  includePos: boolean;
  includePurchases: boolean;
  includeExpenses: boolean;
}): Promise<{
  orders: unknown[];
  purchases: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
}> {
  const orderPromise = params.includePos
    ? (() => {
        let query = supabase
          .from('orders')
          .select('id,status,order_type,table_id,branch_id,total,order_items(quantity)')
          .in('status', ['open', 'held'])
          .limit(5000);
        if (params.branchId) query = query.eq('branch_id', params.branchId);
        return query;
      })()
    : Promise.resolve({ data: [], error: null });

  const purchasePromise = params.includePurchases
    ? (() => {
        let query = supabase
          .from('purchases')
          .select('total,returned_amount,branch_id,created_at')
          .gte('created_at', params.fromIso);
        if (params.branchId) query = query.eq('branch_id', params.branchId);
        return query;
      })()
    : Promise.resolve({ data: [], error: null });

  const expensePromise = params.includeExpenses
    ? (() => {
        let query = supabase
          .from('expenses')
          .select('amount,branch_id,expense_date,status')
          .gte('expense_date', params.fromDate)
          .neq('status', 'voided');
        if (params.branchId) query = query.eq('branch_id', params.branchId);
        return query;
      })()
    : Promise.resolve({ data: [], error: null });

  const [ordersResult, purchasesResult, expensesResult] = await Promise.all([
    orderPromise,
    purchasePromise,
    expensePromise,
  ]);

  return {
    orders: ordersResult.data || [],
    purchases: (purchasesResult.data || []) as Record<string, unknown>[],
    expenses: (expensesResult.data || []) as Record<string, unknown>[],
  };
}
