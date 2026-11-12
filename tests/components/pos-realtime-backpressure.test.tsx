import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePosRealtime } from '@/features/pos/hooks/usePosRealtime';
import type { PosRealtimeData } from '@/features/pos/types';

const mock = vi.hoisted(() => ({ fetch: vi.fn(), wake: new Map<string, () => void>() }));
const empty: PosRealtimeData = { orders: [], tables: [], orderItems: [], kitchenSends: [], watchedOrderIds: [] };
vi.mock('@/features/pos/services/posOrders', () => ({
  fetchActiveOrders: mock.fetch,
  EMPTY_POS_REALTIME: { orders: [], tables: [], orderItems: [], kitchenSends: [], watchedOrderIds: [] },
}));
vi.mock('@/features/pos/services/posRealtime', () => ({
  posRealtimeEventMatchesWatchedOrders: () => true,
  subscribePosRealtime: ({ branchId, onEvent }: { branchId: string; onEvent: () => void }) => {
    mock.wake.set(branchId, onEvent);
    return () => { mock.wake.delete(branchId); };
  },
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  mock.fetch.mockReset().mockResolvedValue(empty); mock.wake.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (document as unknown as { hidden?: boolean }).hidden; });

it('bounds full snapshots during sustained notifications and retains the final refresh', async () => {
  const hook = renderHook(() => usePosRealtime('a'));
  await act(async () => {});
  for (let i = 0; i < 20; i++) {
    await act(async () => { mock.wake.get('a')?.(); await vi.advanceTimersByTimeAsync(500); });
  }
  expect(mock.fetch.mock.calls.length).toBeLessThanOrEqual(6);
  expect(mock.fetch.mock.calls.length).toBeGreaterThan(1);
  expect(hook.result.current.loading).toBe(false);
  await act(async () => { mock.wake.get('a')?.(); await vi.advanceTimersByTimeAsync(2_000); });
  expect(mock.fetch).toHaveBeenLastCalledWith('a');
});

it('finishes initial loading despite an event during a slow read, then refreshes once', async () => {
  let finish!: (value: PosRealtimeData) => void;
  mock.fetch.mockImplementationOnce(() => new Promise<PosRealtimeData>(resolve => { finish = resolve; }));
  const hook = renderHook(() => usePosRealtime('a'));
  await act(async () => { mock.wake.get('a')?.(); await vi.advanceTimersByTimeAsync(2_000); });
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { finish(empty); });
  expect(hook.result.current.loading).toBe(false);
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(mock.fetch).toHaveBeenCalledTimes(2);
});

it('reads the new branch before ending its loading and never schedules work after unmount', async () => {
  let finish!: (value: PosRealtimeData) => void;
  mock.fetch.mockImplementationOnce(() => new Promise<PosRealtimeData>(resolve => { finish = resolve; }));
  const hook = renderHook(({ branch }) => usePosRealtime(branch), { initialProps: { branch: 'a' } });
  hook.rerender({ branch: 'b' });
  expect(hook.result.current.loading).toBe(true);
  await act(async () => { finish(empty); });
  expect(mock.fetch.mock.calls.map(args => args[0])).toEqual(['a', 'b']);
  expect(hook.result.current.loading).toBe(false);
  act(() => { mock.wake.get('b')?.(); });
  hook.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(mock.fetch).toHaveBeenCalledTimes(2);
});
