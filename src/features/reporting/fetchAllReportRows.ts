import { MAX_REPORT_SOURCE_ROWS } from './reportReadLimits';
export interface PagedResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

export interface RangePageQuery<T> {
  range(from: number, to: number): PromiseLike<PagedResult<T>>;
  abortSignal?(signal: AbortSignal): RangePageQuery<T>;
}

/**
 * Fetch every PostgREST row for a report instead of silently trusting the
 * server/default max-row cap. The same filtered builder is re-used while the
 * Range header advances page by page.
 */
export async function fetchAllReportRows<T>(
  query: RangePageQuery<T>,
  pageSize = 1000,
  signal?: AbortSignal,
  maxRows = MAX_REPORT_SOURCE_ROWS,
): Promise<T[]> {
  if (signal && query.abortSignal) query = query.abortSignal(signal);
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    signal?.throwIfAborted();
    const { data, error } = await query.range(from, Math.min(from + pageSize - 1, maxRows));
    if (error) throw new Error(error.message || 'REPORT_PAGE_LOAD_FAILED');
    const page = data || [];
    if (rows.length + page.length > maxRows) throw new Error('REPORT_SOURCE_LIMIT');
    rows.push(...page);
    if (page.length < Math.min(pageSize, maxRows - from + 1)) break;
  }
  return rows;
}
