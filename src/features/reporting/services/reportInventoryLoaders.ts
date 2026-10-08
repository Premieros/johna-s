import { reporting, supabase } from '@/api';
import { loadProductSalesSummary } from './productSalesReport';
import { MAX_REPORT_SOURCE_ROWS } from '../reportReadLimits';
import { fetchAllReportRows, type RangePageQuery } from '../fetchAllReportRows';
import {
  applyProductScopedFilters,
  type EqBuilder,
  type ReportFilters,
} from '../reportFilters';

const filterQ = <T,>(
  q: T,
  filters: ReportFilters,
  applier: (builder: EqBuilder, filters: ReportFilters) => EqBuilder,
): T => applier(q as unknown as EqBuilder, filters) as unknown as T;

const fetchRows = <T,>(query: unknown, signal?: AbortSignal): Promise<T[]> =>
  fetchAllReportRows(query as RangePageQuery<T>, 1000, signal);

/** Product rankings use the same settled, allocated line source as product sales. */
export async function loadTopConsumedProductItems(args: Parameters<typeof loadProductSalesSummary>[0]): Promise<Record<string, unknown>[]> {
  return (await loadProductSalesSummary({ ...args, includeCost: false })).map(row => ({
    product_id: row.productId, unit_name: row.unit, quantity: row.soldQuantity,
    refunded_quantity: row.returnedQuantity, product: { name: row.name }, sale: { branch_id: row.branchId },
  }));
}

export async function loadComponentConsumptionRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters; signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('stock_transactions')
    .select(`branch_id, product_id, quantity, unit_cost, created_at, product:products${args.filters.category ? '!inner' : ''}(name), warehouse:warehouses(name)`)
    .eq('component_flow', true)
    .eq('transaction_type', 'sale')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applyProductScopedFilters);
  return fetchRows<Record<string, unknown>>(q, args.signal);
}

// Rankings and cost detail consume identical component movements and filters.
export const loadTopConsumedComponentRows = loadComponentConsumptionRows;

export async function loadProductBranchRows(productIds: string[], signal?: AbortSignal): Promise<Array<{ id: string; branch_id: string }>> {
  const ids = [...new Set(productIds)];
  if (ids.length > MAX_REPORT_SOURCE_ROWS) throw new Error('REPORT_SOURCE_LIMIT');
  const rows: Array<{ id: string; branch_id: string }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const query = supabase.from('products').select('id, branch_id').in('id', ids.slice(i, i + 100)).order('id');
    rows.push(...await fetchRows<{ id: string; branch_id: string }>(query, signal));
  }
  return rows;
}

async function loadStockSource(branchId: string | null, warehouseId: string | null, lowStock: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const result = await reporting.getOperationalStockSource({ p_branch_id: branchId, p_warehouse_id: warehouseId, p_low_stock: lowStock }, signal);
  signal?.throwIfAborted();
  if (result.error) throw new Error(result.error.message || 'REPORT_STOCK_LOAD_FAILED');
  if (!result.data || ['rawRows','unitRows','rawMasters','rawBalances','unitMasters','unitBatches'].some(key => !Array.isArray(result.data?.[key as keyof typeof result.data]))) throw new Error('REPORT_STOCK_INVALID');
  return result.data;
}
export const loadLowStockSources = (branchId: string | null, signal?: AbortSignal) => loadStockSource(branchId, null, true, signal);

export async function loadWasteRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string; filters: ReportFilters; signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('waste_entries')
    .select('id, branch_id, created_at, quantity, unit_cost, total_cost, reason, product:products(name), warehouse:warehouses(name)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applyProductScopedFilters);
  return fetchRows<Record<string, unknown>>(q, args.signal);
}


export const loadInventoryBatchRows = (args: { branchId: string | null; warehouseId?: string; signal?: AbortSignal }) =>
  loadStockSource(args.branchId, args.warehouseId || null, false, args.signal);
