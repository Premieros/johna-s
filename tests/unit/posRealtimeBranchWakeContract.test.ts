import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  posRealtimeEventMatchesWatchedOrders,
  type PosRealtimeEvent,
} from '@/features/pos/services/posRealtime';

function event(
  table: PosRealtimeEvent['table'],
  newRow: Record<string, unknown> = {},
  oldRow: Record<string, unknown> = {},
): PosRealtimeEvent {
  return { table, eventType: 'UPDATE', newRow, oldRow };
}

describe('POS realtime branch-local wake filtering', () => {
  const watchedOrders = new Set(['order-a', 'order-empty']);
  const visibleItems = new Set(['item-a']);

  it('keeps already branch-filtered tables relevant', () => {
    expect(
      posRealtimeEventMatchesWatchedOrders(
        event('orders', { id: 'order-a' }),
        watchedOrders,
        visibleItems,
      ),
    ).toBe(true);
  });

  it('accepts order_items inserts or updates for watched branch orders', () => {
    expect(
      posRealtimeEventMatchesWatchedOrders(
        event('order_items', { id: 'item-new', order_id: 'order-empty' }),
        watchedOrders,
        visibleItems,
      ),
    ).toBe(true);
  });

  it('rejects order_items events for orders outside the branch snapshot', () => {
    expect(
      posRealtimeEventMatchesWatchedOrders(
        event('order_items', { id: 'item-other', order_id: 'other-branch-order' }),
        watchedOrders,
        visibleItems,
      ),
    ).toBe(false);
  });

  it('matches delete payloads by locally known item id when order_id is absent', () => {
    expect(
      posRealtimeEventMatchesWatchedOrders(
        event('order_items', {}, { id: 'item-a' }),
        watchedOrders,
        visibleItems,
      ),
    ).toBe(true);
    expect(
      posRealtimeEventMatchesWatchedOrders(
        event('order_items', {}, { id: 'other-item' }),
        watchedOrders,
        visibleItems,
      ),
    ).toBe(false);
  });

  it('fails open for unknown payload shapes so optimization cannot hide valid work', () => {
    expect(
      posRealtimeEventMatchesWatchedOrders(
        event('order_items'),
        watchedOrders,
        visibleItems,
      ),
    ).toBe(true);
  });
});

describe('POS realtime traffic contracts', () => {
  it('retains empty open order ids before operational filtering', () => {
    const source = readFileSync('src/features/pos/services/posOrders.ts', 'utf8');
    expect(source).toContain('const watchedOrderIds = orders.map((o) => o.id);');
    expect(source).toContain('return { orders, tables, orderItems, kitchenSends, watchedOrderIds };');
  });

  it('shares the POS realtime channel with the lightweight active-order badge', () => {
    const source = readFileSync('src/features/pos/hooks/useActiveOrderCount.ts', 'utf8');
    expect(source).toContain('subscribePosRealtime({');
    expect(source).not.toContain('.channel(' + String.fromCharCode(96) + 'active-order-count-');
    expect(source).toContain("event.table !== 'orders' && event.table !== 'order_items'");
  });

  it('keeps the existing PR #293 in-flight/trailing coalescing contract', () => {
    const source = readFileSync('src/features/pos/hooks/usePosRealtime.ts', 'utf8');
    expect(source).toContain('const inFlightRef = useRef(false);');
    expect(source).toContain('const trailingRefreshRef = useRef(false);');
    expect(source).toContain('const loadCyclePromiseRef = useRef<Promise<void> | null>(null);');
  });
});
