import { reporting, supabase } from '@/api';
import { fetchAllReportRows, type RangePageQuery } from '../fetchAllReportRows';
import {
  applyExpenseFilters,
  applyPurchaseFilters,
  applySalesFilters,
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

export async function loadOperationalReportPage(args: {
  reportType: 'sales' | 'purchases' | 'expenses'; branchId: string | null;
  from: string; to: string; fromTs: string; toExclusiveTs: string; filters: ReportFilters; page: number;
}) {
  const result = await reporting.getOperationalReportPage({
    p_report_type: args.reportType, p_branch_id: args.branchId,
    p_from_date: args.from, p_to_date: args.to, p_filters: { ...args.filters },
    p_page: args.page, p_page_size: 100, p_from_ts: args.fromTs, p_to_exclusive_ts: args.toExclusiveTs,
  });
  if (result.error) throw new Error(result.error.message || 'REPORT_PAGE_LOAD_FAILED');
  if (!result.data || !Array.isArray(result.data.rows) || !result.data.summary) throw new Error('REPORT_PAGE_INVALID');
  return result.data;
}

export async function loadSalesReportRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('sales')
    .select('id, branch_id, invoice_number, subtotal, discount_amount, tax_amount, total, paid_amount, refunded_amount, payment_method, order_type, status, created_at, customer:customers(name), cashier:users!fk_sales_cashier(full_name,email), warehouse:warehouses(name)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs)
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applySalesFilters);
  return fetchRows<Record<string, unknown>>(q, args.signal);
}

export async function loadPurchaseReportRows(args: {
  branchId: string | null;
  fromTs: string;
  toExclusiveTs: string;
  filters: ReportFilters;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('purchases')
    .select('id, branch_id, invoice_number, total, returned_amount, status, created_at, supplier:suppliers(name)')
    .gte('created_at', args.fromTs)
    .lt('created_at', args.toExclusiveTs)
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applyPurchaseFilters);
  return fetchRows<Record<string, unknown>>(q, args.signal);
}

export async function loadExpenseReportRows(args: {
  branchId: string | null;
  from: string;
  to: string;
  filters: ReportFilters;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('expenses')
    .select('id, branch_id, category, description, amount, expense_date, account_id, expense_account:chart_of_accounts!account_id(code,name,name_en)')
    .eq('status', 'posted')
    .gte('expense_date', args.from)
    .lte('expense_date', args.to)
    .order('expense_date', { ascending: false }).order('id', { ascending: false });
  if (args.branchId) q = q.eq('branch_id', args.branchId);
  q = filterQ(q, args.filters, applyExpenseFilters);
  return fetchRows<Record<string, unknown>>(q, args.signal);
}
