export interface PagedResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

export interface RangePageQuery<T> {
  range(from: number, to: number): PromiseLike<PagedResult<T>>;
}

/**
 * Fetch every PostgREST row for a report instead of silently trusting the
 * server/default max-row cap. The same filtered builder is re-used while the
 * Range header advances page by page.
 */
export async function fetchAllReportRows<T>(
  query: RangePageQuery<T>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || 'REPORT_PAGE_LOAD_FAILED');
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
