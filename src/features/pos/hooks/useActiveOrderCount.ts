import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';
import {
  posRealtimeEventMatchesWatchedOrders,
  subscribePosRealtime,
} from '../services/posRealtime';

const COUNT_CACHE_TTL_MS = 15_000;
const REFRESH_DEBOUNCE_MS = 700;

type CountSnapshot = {
  value: number;
  watchedOrderIds: string[];
  visibleItemIds: string[];
};

type CountCacheEntry = CountSnapshot & {
  loadedAt: number;
};

const countCache = new Map<string, CountCacheEntry>();

async function fetchActiveOrderCount(branchId: string): Promise<CountSnapshot> {
  const { data: orderRows, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('branch_id', branchId)
    .in('status', ['open', 'held']);

  if (ordersError) throw ordersError;

  const watchedOrderIds = (orderRows || []).map((row) => row.id as string).filter(Boolean);
  if (watchedOrderIds.length === 0) {
    return { value: 0, watchedOrderIds: [], visibleItemIds: [] };
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('order_items')
    .select('id,order_id,quantity')
    .in('order_id', watchedOrderIds)
    .gt('quantity', 0);

  if (itemsError) throw itemsError;

  const rows = itemRows || [];
  return {
    value: new Set(rows.map((row) => row.order_id as string).filter(Boolean)).size,
    watchedOrderIds,
    visibleItemIds: rows.map((row) => row.id as string).filter(Boolean),
  };
}

/**
 * Lightweight shell badge data.
 *
 * The global layout only needs the number of active non-empty orders. Loading the
 * full POS realtime snapshot here used to pull tables, order details, kitchen sends
 * and operator labels on every screen. Keep that richer snapshot inside POS/floor-plan
 * pages and share the branch realtime channel without reacting to other branches'
 * order_items events.
 */
export function useActiveOrderCount(branchId: string): number {
  const cached = branchId ? countCache.get(branchId) : undefined;
  const [count, setCount] = useState(cached?.value ?? 0);
  const refreshTimer = useRef<number | null>(null);
  const activeOrderIdsRef = useRef<Set<string>>(new Set(cached?.activeOrderIds || []));
  const positiveItemIdsRef = useRef<Set<string>>(new Set(cached?.positiveItemIds || []));
  const watchedOrderIdsRef = useRef<Set<string>>(new Set(cached?.watchedOrderIds ?? []));
  const visibleItemIdsRef = useRef<Set<string>>(new Set(cached?.visibleItemIds ?? []));

  const refresh = useCallback(async (force = false) => {
    if (!branchId) {
      watchedOrderIdsRef.current = new Set();
      visibleItemIdsRef.current = new Set();
      setCount(0);
      return;
    }

    const current = countCache.get(branchId);
    if (!force && current && Date.now() - current.loadedAt < COUNT_CACHE_TTL_MS) {
      watchedOrderIdsRef.current = new Set(current.watchedOrderIds);
      visibleItemIdsRef.current = new Set(current.visibleItemIds);
      setCount(current.value);
      return;
    }

    try {
      const next = await fetchActiveOrderCount(branchId);
      watchedOrderIdsRef.current = new Set(next.watchedOrderIds);
      visibleItemIdsRef.current = new Set(next.visibleItemIds);
      countCache.set(branchId, { ...next, loadedAt: Date.now() });
      setCount(next.value);
    } catch {
      // Keep the last known badge value. Shell navigation should never be blocked
      // by a non-critical badge refresh.
    }
  }, [branchId]);

  useEffect(() => {
    if (!branchId) {
      watchedOrderIdsRef.current = new Set();
      visibleItemIdsRef.current = new Set();
      setCount(0);
      return;
    }

    const current = countCache.get(branchId);
    watchedOrderIdsRef.current = new Set(current?.watchedOrderIds ?? []);
    visibleItemIdsRef.current = new Set(current?.visibleItemIds ?? []);
    if (current) setCount(current.value);
    void refresh(false);

    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void refresh(true);
      }, REFRESH_DEBOUNCE_MS);
    };

    const unsubscribe = subscribePosRealtime({
      branchId,
      onEvent: scheduleRefresh,
      debounceMs: REFRESH_DEBOUNCE_MS,
      shouldRefresh: (event) => {
        if (event.table !== 'orders' && event.table !== 'order_items') return false;
        return posRealtimeEventMatchesWatchedOrders(
          event,
          watchedOrderIdsRef.current,
          visibleItemIdsRef.current,
        );
      },
    });

    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      unsubscribe();
    };
  }, [branchId, refresh]);

  return count;
}
