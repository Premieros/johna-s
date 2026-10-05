import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReportFilterOptions } from '@/features/reporting/useReportFilterOptions';
import type { ReportType } from '@/features/reporting/reportFilters';

const mocks = vi.hoisted(() => ({ options: vi.fn(), categories: vi.fn() }));
vi.mock('@/features/reporting/services/reportFilterOptions', () => ({ loadReportFilterOptions: mocks.options, loadExpenseCategoryOptions: mocks.categories }));
const empty = { warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [] };
function deferred<T>() { let resolve!: (data: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { mocks.options.mockReset().mockResolvedValue(empty); mocks.categories.mockReset().mockResolvedValue([]); });

describe('scoped report filter options', () => {
  it('ignores old expense categories and publishes only a complete new branch snapshot', async () => {
    const first = deferred<string[]>(); const second = deferred<string[]>();
    mocks.options.mockImplementation(async (branch: string) => ({ ...empty, warehouses: [{ id: branch, name: branch }] }));
    mocks.categories.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { result, rerender } = renderHook(({ branch }) => useReportFilterOptions('expenses', branch, 'user'), { initialProps: { branch: 'a' } });
    await waitFor(() => expect(mocks.categories).toHaveBeenCalledTimes(1));
    rerender({ branch: 'b' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(mocks.categories).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(['B category']); });
    await act(async () => { first.resolve(['A category']); });
    expect(result.current.data?.warehouses[0].id).toBe('b');
    expect(result.current.data?.expenseCategories).toEqual(['B category']);
  });

  it('clears loaded options before painting a new branch and stops unauthenticated reads', async () => {
    mocks.options.mockResolvedValue({ ...empty, warehouses: [{ id: 'a', name: 'A' }] });
    const { result, rerender } = renderHook(({ branch, user }) => useReportFilterOptions('sales', branch, user), { initialProps: { branch: 'a', user: 'reader' as string | undefined } });
    await waitFor(() => expect(result.current.data?.warehouses).toHaveLength(1));
    const pending = deferred<typeof empty>(); mocks.options.mockImplementation(() => pending.promise);
    rerender({ branch: 'b', user: 'reader' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(mocks.options).toHaveBeenCalledTimes(2));
    rerender({ branch: 'b', user: undefined });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.options).toHaveBeenCalledTimes(2);
  });

  it('exposes a partial-read failure and retries the whole snapshot', async () => {
    mocks.categories.mockRejectedValueOnce(new Error('categories unavailable')).mockResolvedValueOnce(['Recovered']);
    const { result } = renderHook(() => useReportFilterOptions('expenses' as ReportType, 'a', 'reader'));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.data).toBeNull();
    await act(async () => { await result.current.reload(); });
    expect(result.current.error).toBeNull();
    expect(result.current.data?.expenseCategories).toEqual(['Recovered']);
    expect(mocks.options).toHaveBeenCalledTimes(2);
  });
});
