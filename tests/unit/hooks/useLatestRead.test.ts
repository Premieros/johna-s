import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLatestRead } from '@/hooks/useLatestRead';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('useLatestRead', () => {
  it('does not start or reload a disabled read and discards it when disabled again', async () => {
    const pending = deferred<string[]>(); const read = vi.fn(() => pending.promise);
    const { result, rerender } = renderHook(({ enabled }) => useLatestRead(read, 0, enabled), { initialProps: { enabled: false } });
    await act(async () => { await result.current.reload(); });
    expect(read).not.toHaveBeenCalled(); expect(result.current.loading).toBe(false);
    rerender({ enabled: true }); await waitFor(() => expect(read).toHaveBeenCalledOnce());
    rerender({ enabled: false }); await act(async () => { pending.resolve(['stale']); });
    expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(false);
  });
  it('clears previous scope and ignores an old response after scope changes', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    let firstSignal: AbortSignal | undefined;
    const readA = vi.fn((signal?: AbortSignal) => { firstSignal = signal; return first.promise; });
    const readB = vi.fn(() => second.promise);
    const { result, rerender } = renderHook(({ read }) => useLatestRead(read), { initialProps: { read: readA } });
    await waitFor(() => expect(readA).toHaveBeenCalledOnce());
    const oldReload = result.current.reload;
    rerender({ read: readB });
    expect(firstSignal?.aborted).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(readB).toHaveBeenCalledOnce());
    await act(async () => { second.resolve(['branch B']); });
    await act(async () => { first.resolve(['branch A']); });
    await act(async () => { await oldReload(); });
    expect(readA).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual(['branch B']);
    expect(result.current.loading).toBe(false);
  });

  it('exposes failure and recovers on retry without reporting an empty success', async () => {
    const read = vi.fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(['entry']);
    const { result } = renderHook(() => useLatestRead(read));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.data).toBeNull();
    await act(async () => { await result.current.reload(); });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(['entry']);
  });

  it('cancels delayed searches when replaced or unmounted', async () => {
    vi.useFakeTimers();
    try {
      const first = vi.fn(async () => ['old']);
      const second = vi.fn(async () => ['new']);
      const { rerender, unmount } = renderHook(({ read }) => useLatestRead(read, 300), { initialProps: { read: first } });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      rerender({ read: second });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledOnce();
      rerender({ read: first });
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(first).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
