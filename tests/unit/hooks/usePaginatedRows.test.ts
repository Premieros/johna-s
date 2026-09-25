import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { clearPaginatedRowsSessionCache, usePaginatedRows } from '@/hooks/usePaginatedRows';

interface Call {
  table: string;
  range?: [number, number];
  filters: { col: string; val: unknown }[];
  head: boolean;
}

const mockAuth = vi.hoisted(() => ({ userId: 'user-1' }));

const mockState = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown[]; count: number }>,
  errors: {} as Record<string, string>,
  calls: [] as Call[],
}));

const mockSupabase = vi.hoisted(() => {
  class Builder {
    selectOpts?: { count?: 'exact'; head?: boolean };
    rangeFrom?: number;
    rangeTo?: number;
    filters: { col: string; val: unknown }[] = [];
    constructor(public table: string) {}
    select(_col: string, opts?: { count?: 'exact'; head?: boolean }) {
      if (opts) this.selectOpts = opts;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ col, val });
      return this;
    }
    order() {
      return this;
    }
    range(from: number, to: number) {
      this.rangeFrom = from;
      this.rangeTo = to;
      return this;
    }
    then(resolve: (v: unknown) => void) {
      const state = mockState.tables[this.table] || { data: [], count: 0 };
      mockState.calls.push({
        table: this.table,
        range: this.selectOpts?.head ? undefined : [this.rangeFrom ?? 0, this.rangeTo ?? 0],
        filters: this.filters,
        head: !!this.selectOpts?.head,
      });
      const fail = mockState.errors[this.table];
      if (fail) {
        return Promise.resolve({ data: null, error: { message: fail } }).then(resolve);
      }
      if (this.selectOpts?.head) {
        return Promise.resolve({ data: null, count: state.count, error: null }).then(resolve);
      }
      const from = this.rangeFrom ?? 0;
      const to = this.rangeTo ?? state.data.length - 1;
      return Promise.resolve({
        data: state.data.slice(from, to + 1),
        count: this.selectOpts?.count === 'exact' ? state.count : null,
        error: null,
      }).then(resolve);
    }
  }
  return {
    from: (table: string) => new Builder(table),
  };
});

vi.mock('@/api', () => ({ supabase: mockSupabase }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: mockAuth.userId } }) }));

function seed(table: string, n: number) {
  mockState.tables[table] = {
    data: Array.from({ length: n }, (_, i) => ({ id: i + 1 })),
    count: n,
  };
}

const dataCalls = (table: string) => mockState.calls.filter((c) => c.table === table && !c.head);
const countCalls = (table: string) => mockState.calls.filter((c) => c.table === table && c.head);

describe('usePaginatedRows', () => {
  beforeEach(() => {
    mockState.tables = {};
    mockState.errors = {};
    mockState.calls = [];
    mockAuth.userId = 'user-1';
    clearPaginatedRowsSessionCache();
  });

  it('fetches pageSize+1 without an exact count and exposes only pageSize rows', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toHaveLength(10);
    expect(result.current.rows[0]).toEqual({ id: 1 });
    expect(result.current.total).toBeNull();
    expect(result.current.hasMore).toBe(true);
    const r = dataCalls('sales')[0].range;
    expect(r).toEqual([0, 10]);
    expect(dataCalls('sales')).toHaveLength(1);
    expect(countCalls('sales')).toHaveLength(0);
  });

  it('defaults to a bounded 50-row first page plus one lookahead row', async () => {
    seed('products', 80);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'products' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toHaveLength(50);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBeNull();
    expect(dataCalls('products')[0].range).toEqual([0, 50]);
  });

  it('applies branch_id and extra equality filters to the data query without a count request', async () => {
    seed('orders', 3);
    const { result } = renderHook(() =>
      usePaginatedRows<{ id: number }>({
        table: 'orders',
        branch_id: 'b1',
        filters: [{ column: 'status', value: 'open' }],
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(dataCalls('orders').length).toBe(1));

    expect(countCalls('orders')).toHaveLength(0);
    const call = dataCalls('orders')[0];
    expect(call.filters).toContainEqual({ col: 'branch_id', val: 'b1' });
    expect(call.filters).toContainEqual({ col: 'status', val: 'open' });
  });

  it('loadMore appends the next page and hasMore flips to false when done', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(10);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(20);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(25);
    expect(result.current.hasMore).toBe(false);
    expect(dataCalls('sales').map((c) => c.range)).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(result.current.total).toBe(25);
  });

  it('refresh reloads from the first page and resets accumulated rows', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(20);

    seed('sales', 30);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.rows).toHaveLength(10);
    expect(result.current.total).toBeNull();
    expect(result.current.hasMore).toBe(true);
  });

  it('exposes setRows for optimistic local updates', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.setRows((prev) => prev.filter((r) => r.id !== 1));
    });
    expect(result.current.rows).toHaveLength(9);
  });

  it('keeps the first page when enabled=false and fires no data request', async () => {
    seed('sales', 5);
    const { result } = renderHook(() =>
      usePaginatedRows<{ id: number }>({ table: 'sales', enabled: false })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(0);
    expect(dataCalls('sales')).toHaveLength(0);
  });

  it('surfaces query errors instead of throwing', async () => {
    seed('sales', 5);
    mockState.errors.sales = 'boom';
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain('تعذر إكمال العملية بسبب خطأ في النظام');
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.hasMore).toBe(false);
  });

  it('reuses session rows immediately on remount and revalidates from the server', async () => {
    seed('sales', 12);
    const first = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.rows).toHaveLength(10);
    first.unmount();

    mockState.calls = [];
    seed('sales', 13);
    const second = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));

    expect(second.result.current.rows).toHaveLength(10);
    expect(second.result.current.loading).toBe(false);
    await waitFor(() => expect(dataCalls('sales')).toHaveLength(1));
    await waitFor(() => expect(second.result.current.rows).toHaveLength(10));
  });

  it('does not reuse cached rows across authenticated users', async () => {
    seed('sales', 5);
    const first = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.rows).toHaveLength(5);
    first.unmount();

    mockAuth.userId = 'user-2';
    mockState.calls = [];
    seed('sales', 2);
    const second = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));
    expect(second.result.current.rows).toHaveLength(0);
    expect(second.result.current.loading).toBe(true);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.rows).toHaveLength(2);
  });

  it('fetchAll bypasses session display cache and fetches the full server dataset', async () => {
    seed('sales', 25);
    const { result } = renderHook(() => usePaginatedRows<{ id: number }>({ table: 'sales', pageSize: 10 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(10);

    mockState.calls = [];
    const all = await result.current.fetchAll();
    expect(all).toHaveLength(25);
    expect(dataCalls('sales')).toHaveLength(1);
    expect(dataCalls('sales')[0].range).toEqual([0, 999]);
  });
});
