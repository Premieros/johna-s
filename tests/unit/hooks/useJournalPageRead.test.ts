import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useJournalPageRead } from '@/features/accounting/useJournalPageRead';
import type { JournalPageDto } from '@/lib/types';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/api/domains/accounting', () => ({ accounting: { getJournalsPage: read } }));
const scope = { branchId: 'a', userId: 'u', from: '', to: '', referenceType: '', search: '' };
const page = (more = false): JournalPageDto => ({
  rows: [], summary: { total_count: 205, debit_total: 2529.7, credit_total: 2529.7, balance: 0 },
  page_size: 100, has_more: more,
  next_cursor: more ? { entry_date: '2026-10-05', entry_number: 'JE-100', id: 'cursor-a' } : null,
});
const ok = (more = false) => ({ data: page(more), error: null });
beforeEach(() => read.mockReset());

describe('journal server page scope and navigation', () => {
  it('requests only 100 details and keeps complete server totals when changing pages', async () => {
    read.mockResolvedValue(ok(true)).mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(ok());
    const { result } = renderHook(() => useJournalPageRead(scope));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.summary.total_count).toBe(205);
    expect(read.mock.calls[0][0]).toMatchObject({ p_page_size: 100, p_after_id: null });
    act(() => { result.current.next(); result.current.next(); });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(read.mock.calls[1][0]).toMatchObject({ p_after_id: 'cursor-a', p_after_entry_number: 'JE-100' });
    expect(result.current.index).toBe(1);
    expect(result.current.data?.summary.total_count).toBe(205);
    act(() => result.current.previous());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.index).toBe(0);
    expect(read.mock.lastCall?.[0].p_after_id).toBeNull();
  });

  it('resets branch/user/filter cursors before any new-scope request and never resumes an old branch page', async () => {
    read.mockResolvedValue(ok(true));
    const { result, rerender } = renderHook(props => useJournalPageRead(props), { initialProps: scope });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.next());
    await waitFor(() => expect(result.current.index).toBe(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const nextScope of [{ ...scope, branchId: 'b' }, scope, { ...scope, userId: 'other' }, { ...scope, from: '2026-10-01' }]) {
      rerender(nextScope);
      expect(result.current.index).toBe(0);
      expect(result.current.data).toBeNull();
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(read.mock.lastCall?.[0]).toMatchObject({ p_branch_id: nextScope.branchId, p_after_id: null });
    }
  });

  it('discards a delayed old-branch response after the new branch has loaded', async () => {
    let resolve!: (value: ReturnType<typeof ok>) => void;
    read.mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce(ok());
    const { result, rerender } = renderHook(props => useJournalPageRead(props), { initialProps: scope });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    rerender({ ...scope, branchId: 'b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => resolve({ ...ok(), data: { ...page(), summary: { ...page().summary, total_count: 999 } } }));
    expect(result.current.data?.summary.total_count).toBe(205);
  });

  it('shows unavailable on failure, retries the same page, and refuses invalid snapshots', async () => {
    read.mockResolvedValueOnce({ data: null, error: new Error('denied') }).mockResolvedValueOnce(ok());
    const { result } = renderHook(() => useJournalPageRead(scope));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.summary.total_count).toBe(205));
    read.mockResolvedValueOnce({ data: null, error: null });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeNull();
  });

  it('refreshes from the first page after a successful posting instead of retaining old cursors', async () => {
    read.mockResolvedValue(ok(true));
    const { result } = renderHook(() => useJournalPageRead(scope));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.next());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.index).toBe(1);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.index).toBe(0);
    expect(read.mock.lastCall?.[0].p_after_id).toBeNull();
  });

  it('does not read without a signed-in user or branch', async () => {
    const { result } = renderHook(() => useJournalPageRead({ ...scope, userId: undefined }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(read).not.toHaveBeenCalled();
    expect(result.current.data?.rows).toEqual([]);
  });
});
