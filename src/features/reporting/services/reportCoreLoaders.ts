import { reporting } from '@/api';
import type { ReportFilters } from '../reportFilters';

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


export interface DatasetArgs {
 branchId: string | null; from: string; to: string; fromTs: string; toExclusiveTs: string;
 filters: ReportFilters; signal?: AbortSignal; returnsOnly?: boolean; includeItems?: boolean; settledOnly?: boolean;
}
async function loadDataset(type: 'sales' | 'purchases' | 'expenses', args: DatasetArgs): Promise<Record<string, unknown>[]> {
 args.signal?.throwIfAborted();
 const result = await reporting.getOperationalReportDataset({ p_report_type: type, p_branch_id: args.branchId,
  p_from_date: args.from, p_to_date: args.to, p_filters: { ...args.filters, ...(args.returnsOnly ? { returns_only: 'true' } : {}), ...(args.includeItems ? { include_items: 'true' } : {}), ...(args.settledOnly ? { settled_only: 'true' } : {}) },
  p_from_ts: args.fromTs, p_to_exclusive_ts: args.toExclusiveTs }, args.signal);
 args.signal?.throwIfAborted();
 if (result.error) throw new Error(result.error.message || 'REPORT_DATASET_LOAD_FAILED');
 if (!result.data || !Array.isArray(result.data.rows) || !result.data.summary || result.data.rows.length !== result.data.summary.count) throw new Error('REPORT_DATASET_INCOMPLETE');
 return result.data.rows;
}
export const loadSalesReportRows = (args: DatasetArgs) => loadDataset('sales', args);
export const loadPurchaseReportRows = (args: DatasetArgs) => loadDataset('purchases', args);
export const loadExpenseReportRows = (args: DatasetArgs) => loadDataset('expenses', args);
