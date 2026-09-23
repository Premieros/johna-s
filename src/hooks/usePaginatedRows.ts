import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/api';
import { userFacingErrorMessage } from '@/lib/userFacingError';

// Unified, reusable paginated-rows hook (audit M7). Every list/table page that
// previously issued an unbounded `.select('*')` (or a silent `.limit(N)`)
// should use this hook so each HTTP request is capped at `pageSize` rows and
// the user can explicitly load more. Search, when configured, is executed on
// the server so pagination/counts always refer to the complete matching set.
export interface PaginatedQueryOptions {
  /** Table name, e.g. 'sales'. */
  table: string;
  /** Column list for the data query (supports relations). Default '*' */
  select?: string;
  /** Server-side ordering applied to the data query. */
  order?: { column: string; ascending?: boolean };
  /** Equality filter on branch_id (skipped when null/undefined). */
  branch_id?: string | null;
  /** Optional PostgREST OR expression for trusted page-defined compound scopes. */
  or?: string;
  /** Additional equality filters: [{ column: 'status', value: 'open' }]. */
  filters?: { column: string; value: unknown }[];
  /** Optional server-side text search over one or more plain columns. */
  search?: { term: string; columns: string[] };
  /** Optional lower-bound filter, used by centralized historical-data access. */
  min?: { column: string; value: string };
  /** Rows exposed per page. The hook fetches one extra row to detect hasMore. Default 50. */
  pageSize?: number;
  /** Set to false to keep the hook idle (e.g. no branch selected yet). Default true. */
  enabled?: boolean;
}

export interface UsePaginatedRowsResult<T> {
  rows: T[];
  /** Direct setter so pages can keep optimistic local updates after CRUD. */
  setRows: Dispatch<SetStateAction<T[]>>;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Fetch every matching server row independently of what the user has loaded. Intended for exports. */
  fetchAll: () => Promise<T[]>;
}

type FilterBuilder = ReturnType<ReturnType<typeof supabase.from>['select']>;

function safeSearchTerm(value: string): string {
  // `.or()` uses PostgREST filter syntax, so remove syntax separators while
  // keeping ordinary user text, spaces, Arabic, digits, barcode and SKU data.
  return value.trim().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');
}

export function usePaginatedRows<T>(opts: PaginatedQueryOptions): UsePaginatedRowsResult<T> {
  const { table, select = '*', order, branch_id, or, filters, search, min, pageSize = 50, enabled = true } = opts;
  const filterKey = JSON.stringify(filters ?? []);
  const searchKey = JSON.stringify({ term: search?.term ?? '', columns: search?.columns ?? [] });
  const orderKey = order?.column ?? '';
  const orderAsc = order?.ascending !== false;

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const gen = useRef(0);

  const applyFilters = useCallback(
    (q: FilterBuilder): FilterBuilder => {
      let bq = q;
      if (branch_id) bq = bq.eq('branch_id', branch_id);
      if (or) bq = bq.or(or);
      for (const f of filters ?? []) bq = bq.eq(f.column, f.value);
      if (min?.column && min.value) bq = bq.gte(min.column, min.value);
      const term = safeSearchTerm(search?.term ?? '');
      const columns = (search?.columns ?? []).filter((column) => /^[a-zA-Z0-9_]+$/.test(column));
      if (term && columns.length > 0) {
        const filter = columns.map((column) => `${column}.ilike.*${term}*`).join(',');
        bq = bq.or(filter);
      }
      return bq;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by stable serialized option values
    [branch_id, or, filterKey, searchKey, min?.column, min?.value]
  );

  const buildDataQuery = useCallback(
    (from: number, to: number): FilterBuilder => {
      // `table` and `select` are intentionally dynamic in this generic hook.
      // Narrow the Supabase overload to the filter-builder shape once here so
      // TypeScript does not recursively instantiate schema-string error types.
      const source = supabase.from(table) as unknown as {
        select: (columns: string) => FilterBuilder;
      };
      let q = applyFilters(source.select(select));
      if (order) q = q.order(order.column, { ascending: orderAsc });
      return q.range(from, to);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by stable orderKey/orderAsc; `order` identity changes each render
    [table, select, applyFilters, orderKey, orderAsc]
  );

  const refresh = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      // Fetch one extra row instead of asking Postgres/RLS for an exact count.
      // This keeps first paint bounded even on large or heavily protected tables.
      const { data, error: err } = await buildDataQuery(0, pageSize);
      if (g !== gen.current) return;
      if (err) {
        setError(userFacingErrorMessage(err));
        setRows([]);
        setTotal(0);
        setHasMore(false);
        return;
      }
      const page = ((data as T[]) || []).slice(0, pageSize);
      const more = ((data as T[]) || []).length > pageSize;
      setRows(page);
      setHasMore(more);
      setTotal(more ? null : page.length);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [buildDataQuery, pageSize]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    const g = gen.current;
    setLoadingMore(true);
    try {
      const { data, error: err } = await buildDataQuery(rows.length, rows.length + pageSize);
      if (g !== gen.current) return;
      if (err) {
        setError(userFacingErrorMessage(err));
        return;
      }
      const fetched = (data as T[]) || [];
      const page = fetched.slice(0, pageSize);
      const more = fetched.length > pageSize;
      setRows((prev) => {
        const next = [...prev, ...page];
        if (!more) setTotal(next.length);
        return next;
      });
      setHasMore(more);
    } finally {
      if (g === gen.current) setLoadingMore(false);
    }
  }, [buildDataQuery, pageSize, rows.length, loading, loadingMore]);

  const fetchAll = useCallback(async (): Promise<T[]> => {
    if (!enabled) return [];
    const batchSize = Math.max(pageSize, 1000);
    const all: T[] = [];
    let offset = 0;
    while (true) {
      const { data, error: err } = await buildDataQuery(offset, offset + batchSize - 1);
      if (err) throw err;
      const batch = (data as T[]) || [];
      all.push(...batch);
      if (batch.length < batchSize) break;
      offset += batch.length;
    }
    return all;
  }, [buildDataQuery, enabled, pageSize]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh, enabled]);

  return { rows, setRows, loading, loadingMore, error, total, hasMore, loadMore, refresh, fetchAll };
}
