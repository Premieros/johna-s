import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';
const mocks = vi.hoisted(() => ({ callbacks: new Map<string, (payload: unknown) => void>(), channel: vi.fn(), remove: vi.fn() }));
vi.mock('@/api', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.remove } }));
let hidden = false;
let cleanups: (() => void)[] = [];
beforeEach(() => {
  hidden = false; vi.useFakeTimers(); mocks.callbacks.clear(); mocks.channel.mockReset(); mocks.remove.mockReset();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((_kind, filter, callback) => { mocks.callbacks.set(filter.table, callback); return channel; });
  channel.subscribe.mockReturnValue(channel); mocks.channel.mockReturnValue(channel);
});
afterEach(() => { cleanups.forEach(fn => fn()); cleanups = []; delete (document as unknown as {hidden?: boolean}).hidden; vi.useRealTimers(); });
function visibility(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); }
describe('POS display refresh visibility', () => {
  it('makes no hidden refreshes and refreshes each current listener once on return', () => {
    const a = vi.fn(), b = vi.fn();
    cleanups.push(subscribePosRealtime({ branchId: 'a', onEvent: a }), subscribePosRealtime({ branchId: 'a', onEvent: b }));
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    visibility(true);
    for (let i = 0; i < 20; i++) mocks.callbacks.get('orders')?.({eventType: 'UPDATE', new: {id: 'o'}});
    vi.advanceTimersByTime(10000); expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled();
    visibility(false); expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending visible burst on hide and retains normal visible events', () => {
    const read = vi.fn(); cleanups.push(subscribePosRealtime({branchId: 'b', onEvent: read}));
    mocks.callbacks.get('orders')?.({}); visibility(true); vi.advanceTimersByTime(1000); expect(read).not.toHaveBeenCalled();
    visibility(false); expect(read).toHaveBeenCalledTimes(1);
    mocks.callbacks.get('orders')?.({}); vi.advanceTimersByTime(300); expect(read).toHaveBeenCalledTimes(2);
  });
  it('removes the visibility callback and channel when the final listener leaves', () => {
    const read = vi.fn(); const unsubscribe = subscribePosRealtime({branchId: 'c', onEvent: read});
    unsubscribe(); visibility(true); visibility(false);
    expect(read).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
