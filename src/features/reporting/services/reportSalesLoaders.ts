import { supabase } from '@/api';
import { fetchAllReportRows, type RangePageQuery } from '../fetchAllReportRows';
import { applySalesFilters, type EqBuilder, type ReportFilters } from '../reportFilters';

const filterQ = <T,>(
  q: T,
  filters: ReportFilters,
  applier: (builder: EqBuilder, filters: ReportFilters) => EqBuilder,
): T => applier(q as unknown as EqBuilder, filters) as unknown as T;

const fetchRows = <T,>(query: unknown): Promise<T[]> =>
  fetchAllReportRows(query as RangePageQuery<T>);

export async function loadSalesByEmployeeRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('sales')
    .select('branch_id, cashier_id, total, refunded_amount, users:users!fk_sales_cashier(full_name, email)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applySalesFilters);
  return fetchRows<Record<string, unknown>>(q);
}

export async function loadDetailedInvoiceRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('sales')
    .select('id, branch_id, invoice_number, total, paid_amount, refunded_amount, payment_method, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs)
    .order('created_at', { ascending: false });
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applySalesFilters);
  return fetchRows<Record<string, unknown>>(q);
}

export async function loadCashierPerformanceRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('sales')
    .select('branch_id, cashier_id, warehouse_id, total, refunded_amount, payment_method, status, created_at, users:users!fk_sales_cashier(full_name, email)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs);
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  return fetchRows<Record<string, unknown>>(q);
}

export async function loadReturnRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('sales')
    .select('id, branch_id, invoice_number, total, refunded_amount, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs)
    .or('refunded_amount.gt.0,status.in.(returned,refunded,cancelled)');
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  return fetchRows<Record<string, unknown>>(q);
}
