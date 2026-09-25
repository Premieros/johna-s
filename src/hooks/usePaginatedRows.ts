import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
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

interface SessionCacheEntry<T> {
  rows: T[];
  total: number | null;
  hasMore: boolean;
  updatedAt: number;
}


// RAM-only cache. Nothing here is written to localStorage/IndexedDB. The query
// key includes the authenticated user and every business scope/filter so cached
// rows can never be reused across users, branches, searches, or history ranges.
const SESSION_CACHE_LIMIT = 80;
const sessionRowsCache = new Map<string, SessionCacheEntry<unknown>>();

function readSessionCache<T>(key: string): SessionCacheEntry<T> | undefined {
  return sessionRowsCache.get(key) as SessionCacheEntry<T> | undefined;
}

function writeSessionCache<T>(key: string, entry: Omit<SessionCacheEntry<T>, 'updatedAt'>): void {
  if (sessionRowsCache.has(key)) sessionRowsCache.delete(key);
  sessionRowsCache.set(key, { ...entry, updatedAt: Date.now() } as SessionCacheEntry<unknown>);
  while (sessionRowsCache.size > SESSION_CACHE_LIMIT) {
    const oldest = sessionRowsCache.keys().next().value as string | undefined;
    if (!oldest) break;
    sessionRowsCache.delete(oldest);
  }
}

export function clearPaginatedRowsSessionCache(): void {
  sessionRowsCache.clear();
}

function safeSearchTerm(value: string): string {
  // `.or()` uses PostgREST filter syntax, so remove syntax separators while
  // keeping ordinary user text, spaces, Arabic, digits, barcode and SKU data.
  return value.trim().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');
}

export function usePaginatedRows<T>(opts: PaginatedQueryOptions): UsePaginatedRowsResult<T> {
  const { user } = useAuth();
  const { table, select = '*', order, branch_id, or, filters, search, min, pageSize = 50, enabled = true } = opts;
  const filterKey = JSON.stringify(filters ?? []);
  const searchKey = JSON.stringify({ term: search?.term ?? '', columns: search?.columns ?? [] });
  const orderKey = order?.column ?? '';
  const orderAsc = order?.ascending !== false;
  const userId = user?.id ?? 'anonymous';

  const queryKey = useMemo(
    () => JSON.stringify({
      userId,
      table,
      select,
      orderKey,
      orderAsc,
      branch_id: branch_id ?? null,
      or: or ?? null,
      filterKey,
      searchKey,
      minColumn: min?.column ?? null,
      minValue: min?.value ?? null,
      pageSize,
    }),
    [userId, table, select, orderKey, orderAsc, branch_id, or, filterKey, searchKey, min?.column, min?.value, pageSize],
  );

  const initialCache = readSessionCache<T>(queryKey);
  const [rows, setRowsState] = useState<T[]>(() => initialCache?.rows ?? []);
  const [loading, setLoading] = useState(() => enabled && !initialCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(() => initialCache?.total ?? null);
  const [hasMore, setHasMore] = useState(() => initialCache?.hasMore ?? false);
  const gen = useRef(0);

  const setRows = useCallback<Dispatch<SetStateAction<T[]>>>((update) => {
    setRowsState((previous) => {
      const next = typeof update === 'function'
        ? (update as (rows: T[]) => T[])(previous)
        : update;
      const cached = readSessionCache<T>(queryKey);
      writeSessionCache<T>(queryKey, {
        rows: next,
        total: cached?.total ?? total,
        hasMore: cached?.hasMore ?? hasMore,
      });
      return next;
    });
  }, [queryKey, total, hasMore]);

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

  // Synchronize display scope before paint. This prevents a branch/filter change
  // from flashing rows belonging to the previous scope while the server request starts.
  useLayoutEffect(() => {
    gen.current += 1;
    setError(null);
    setLoadingMore(false);

    if (!enabled) {
      setRowsState([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }

    const cached = readSessionCache<T>(queryKey);
    if (cached) {
      setRowsState(cached.rows);
      setTotal(cached.total);
      setHasMore(cached.hasMore);
      setLoading(false);
    } else {
      setRowsState([]);
      setTotal(null);
      setHasMore(false);
      setLoading(true);
    }
  }, [queryKey, enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    const g = ++gen.current;
    const cached = readSessionCache<T>(queryKey);
    // Stale-while-revalidate: keep already known rows visible and refresh quietly.
    setLoading(!cached);
    setError(null);

    try {
      // Identical concurrent PostgREST GET requests are already coalesced by
      // createPostgrestDedupingFetch, which also avoids attaching post-mutation
      // reads to older in-flight responses. Keep this hook focused on display SWR.
      const { data, error: err } = await buildDataQuery(0, pageSize);
      if (g !== gen.current) return;
      if (err) {
        setError(userFacingErrorMessage(err));
        // If there is no safe session snapshot, fail empty. If there is one,
        // preserve it and surface the refresh error without blocking the user.
        if (!cached) {
          setRowsState([]);
          setTotal(0);
          setHasMore(false);
        }
        return;
      }

      const fetched = (data as T[]) || [];
      const page = fetched.slice(0, pageSize);
      const more = fetched.length > pageSize;
      const nextTotal = more ? null : page.length;
      setRowsState(page);
      setHasMore(more);
      setTotal(nextTotal);
      writeSessionCache<T>(queryKey, { rows: page, hasMore: more, total: nextTotal });
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [buildDataQuery, enabled, pageSize, queryKey]);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || loadingMore) return;
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
      setRowsState((prev) => {
        const next = [...prev, ...page];
        const nextTotal = more ? null : next.length;
        writeSessionCache<T>(queryKey, { rows: next, hasMore: more, total: nextTotal });
        return next;
      });
      setHasMore(more);
      if (!more) setTotal(rows.length + page.length);
      else setTotal(null);
    } finally {
      if (g === gen.current) setLoadingMore(false);
    }
  }, [buildDataQuery, enabled, pageSize, queryKey, rows.length, loading, loadingMore]);

  const fetchAll = useCallback(async (): Promise<T[]> => {
    if (!enabled) return [];
    // Export/read-all is intentionally database-first and NEVER reads from the
    // session display cache. Every matching server row is fetched in batches.
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
    if (!enabled) return;
    void refresh();
  }, [refresh, enabled]);

  return { rows, setRows, loading, loadingMore, error, total, hasMore, loadMore, refresh, fetchAll };
}
