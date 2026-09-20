import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';

const COUNT_CACHE_TTL_MS = 15_000;
const REFRESH_DEBOUNCE_MS = 700;

type CountCacheEntry = {
  value: number;
  loadedAt: number;
};

const countCache = new Map<string, CountCacheEntry>();

async function fetchActiveOrderCount(branchId: string): Promise<number> {
  const { data: orderRows, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('branch_id', branchId)
    .in('status', ['open', 'held']);

  if (ordersError) throw ordersError;

  const orderIds = (orderRows || []).map((row) => row.id as string).filter(Boolean);
  if (orderIds.length === 0) return 0;

  const { data: itemRows, error: itemsError } = await supabase
    .from('order_items')
    .select('order_id,quantity')
    .in('order_id', orderIds)
    .gt('quantity', 0);

  if (itemsError) throw itemsError;

  return new Set((itemRows || []).map((row) => row.order_id as string).filter(Boolean)).size;
}

/**
 * Lightweight shell badge data.
 *
 * The global layout only needs the number of active non-empty orders. Loading the
 * full POS realtime snapshot here used to pull tables, order details, kitchen sends
 * and operator labels on every screen. Keep that richer snapshot inside POS/floor-plan
 * pages and use this narrow query for the shell.
 */
export function useActiveOrderCount(branchId: string): number {
  const cached = branchId ? countCache.get(branchId) : undefined;
  const [count, setCount] = useState(cached?.value ?? 0);
  const refreshTimer = useRef<number | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (!branchId) {
      setCount(0);
      return;
    }

    const current = countCache.get(branchId);
    if (!force && current && Date.now() - current.loadedAt < COUNT_CACHE_TTL_MS) {
      setCount(current.value);
      return;
    }

    try {
      const next = await fetchActiveOrderCount(branchId);
      countCache.set(branchId, { value: next, loadedAt: Date.now() });
      setCount(next);
    } catch {
      // Keep the last known badge value. Shell navigation should never be blocked
      // by a non-critical badge refresh.
    }
  }, [branchId]);

  useEffect(() => {
    if (!branchId) {
      setCount(0);
      return;
    }

    const current = countCache.get(branchId);
    if (current) setCount(current.value);
    void refresh(false);

    const scheduleRefresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void refresh(true);
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`active-order-count-${branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [branchId, refresh]);

  return count;
}
