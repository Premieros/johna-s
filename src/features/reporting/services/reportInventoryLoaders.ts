import { supabase } from '@/api';
import { fetchAllReportRows, type RangePageQuery } from '../fetchAllReportRows';
import {
  applyProductScopedFilters,
  applySaleItemFilters,
  type EqBuilder,
  type ReportFilters,
} from '../reportFilters';

const filterQ = <T,>(
  q: T,
  filters: ReportFilters,
  applier: (builder: EqBuilder, filters: ReportFilters) => EqBuilder,
): T => applier(q as unknown as EqBuilder, filters) as unknown as T;

const fetchRows = <T,>(query: unknown): Promise<T[]> =>
  fetchAllReportRows(query as RangePageQuery<T>);

export async function loadTopConsumedProductItems(args: {
  branchId: string | null;
  filters: ReportFilters;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('sale_items')
    .select('quantity, refunded_quantity, product:products(name), sale:sales(created_at, branch_id, order_type, warehouse_id, cashier_id, customer_id)');
  if (args.branchId) q = q.eq('sale.branch_id', args.branchId);
  q = filterQ(q, args.filters, applySaleItemFilters);
  return fetchRows<Record<string, unknown>>(q);
}

export async function loadComponentConsumptionRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('stock_transactions')
    .select('branch_id, product_id, quantity, unit_cost, created_at, product:products(name), warehouse:warehouses(name)')
    .eq('component_flow', true)
    .eq('transaction_type', 'sale')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applyProductScopedFilters);
  return fetchRows<Record<string, unknown>>(q);
}

export async function loadTopConsumedComponentRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('stock_transactions')
    .select('branch_id, product_id, quantity, product:products(name)')
    .eq('component_flow', true)
    .eq('transaction_type', 'sale')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applyProductScopedFilters);
  return fetchRows<Record<string, unknown>>(q);
}

export async function loadProductBranchRows(productIds: string[]): Promise<Array<{ id: string; branch_id: string }>> {
  if (productIds.length === 0) return [];
  const { data } = await supabase.from('products').select('id, branch_id').in('id', productIds);
  return (data || []) as Array<{ id: string; branch_id: string }>;
}

export async function loadLowStockSources(branchId: string | null): Promise<{
  rawMasters: Record<string, unknown>[];
  rawBalances: Record<string, unknown>[];
  unitMasters: Record<string, unknown>[];
  unitBatches: Record<string, unknown>[];
}> {
  let rawMasterQuery = supabase.from('raw_materials').select('id,branch_id,name,code,min_stock,is_active').eq('is_active', true);
  let rawBalanceQuery = supabase.from('raw_material_inventory').select('raw_material_id,branch_id,quantity,min_stock');
  let unitMasterQuery = supabase.from('inventory_units').select('id,branch_id,name,barcode,min_stock,low_stock_threshold,is_active').eq('is_active', true);
  let unitBatchQuery = supabase.from('inventory_unit_batches').select('unit_id,branch_id,quantity');

  if (branchId) {
    rawMasterQuery = rawMasterQuery.eq('branch_id', branchId);
    rawBalanceQuery = rawBalanceQuery.eq('branch_id', branchId);
    unitMasterQuery = unitMasterQuery.eq('branch_id', branchId);
    unitBatchQuery = unitBatchQuery.eq('branch_id', branchId);
  }

  const [rawMasters, rawBalances, unitMasters, unitBatches] = await Promise.all([
    fetchRows<Record<string, unknown>>(rawMasterQuery),
    fetchRows<Record<string, unknown>>(rawBalanceQuery),
    fetchRows<Record<string, unknown>>(unitMasterQuery),
    fetchRows<Record<string, unknown>>(unitBatchQuery),
  ]);

  return { rawMasters, rawBalances, unitMasters, unitBatches };
}

export async function loadWasteRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('waste_entries')
    .select('id, branch_id, created_at, quantity, unit_cost, total_cost, reason, product:products(name), warehouse:warehouses(name)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  return fetchRows<Record<string, unknown>>(q);
}


export async function loadInventoryBatchRows(args: {
  branchId: string | null;
  warehouseId?: string;
}): Promise<{
  rawRows: Record<string, unknown>[];
  unitRows: Record<string, unknown>[];
}> {
  let rawQuery = supabase
    .from('raw_material_batches')
    .select('branch_id,warehouse_id,quantity,raw_material:raw_materials(id,name,code,min_stock),warehouse:warehouses(name)');
  let unitQuery = supabase
    .from('inventory_unit_batches')
    .select('branch_id,warehouse_id,quantity,unit:inventory_units(id,name,barcode,min_stock,low_stock_threshold),warehouse:warehouses(name)');

  if (args.branchId) {
    rawQuery = rawQuery.eq('branch_id', args.branchId);
    unitQuery = unitQuery.eq('branch_id', args.branchId);
  }
  if (args.warehouseId) {
    rawQuery = rawQuery.eq('warehouse_id', args.warehouseId);
    unitQuery = unitQuery.eq('warehouse_id', args.warehouseId);
  }

  const [rawRows, unitRows] = await Promise.all([
    fetchRows<Record<string, unknown>>(rawQuery),
    fetchRows<Record<string, unknown>>(unitQuery),
  ]);
  return { rawRows, unitRows };
}
