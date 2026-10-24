import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActiveOrders, EMPTY_POS_REALTIME } from '../services/posOrders';
import { posRealtimeEventMatchesWatchedOrders, subscribePosRealtime } from '../services/posRealtime';
import { mergeItemTransferSnapshot } from '../utils/itemTransfer';
import type { PosItemTransferSnapshot, PosRealtimeData } from '../types';

export interface UsePosRealtimeResult {
  data: PosRealtimeData;
  loading: boolean;
  error: string;
  applyTransferSnapshot: (snapshot: PosItemTransferSnapshot) => void;
}

export function usePosRealtime(branchId: string): UsePosRealtimeResult {
  const [data, setData] = useState<PosRealtimeData>(EMPTY_POS_REALTIME);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeBranchRef = useRef(branchId);
  const inFlightRef = useRef(false);
  const trailingRefreshRef = useRef(false);
  const loadCyclePromiseRef = useRef<Promise<void> | null>(null);
  const watchedOrderIdsRef = useRef<Set<string>>(new Set());
  const visibleItemIdsRef = useRef<Set<string>>(new Set());
  const mutationRevisionRef = useRef(0);
  const eventRefreshTimerRef = useRef<number | null>(null);

  const load = useCallback((requestedBranch: string): Promise<void> => {
    if (!requestedBranch || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve();

    // A kitchen send/order update can emit several Realtime events together.
    // Return the same in-flight promise when coalescing so branch-change loading
    // cannot finish before the queued snapshot for the new branch completes.
    if (inFlightRef.current && loadCyclePromiseRef.current) {
      trailingRefreshRef.current = true;
      return loadCyclePromiseRef.current;
    }

    inFlightRef.current = true;
    const cycle = (async () => {
      let targetBranch = requestedBranch;
      try {
        while (targetBranch) {
          trailingRefreshRef.current = false;
          try {
            const revision = mutationRevisionRef.current;
            const snapshot = await fetchActiveOrders(targetBranch);
            if (activeBranchRef.current === targetBranch && revision === mutationRevisionRef.current) {
              watchedOrderIdsRef.current = new Set(snapshot.watchedOrderIds);
              visibleItemIdsRef.current = new Set(snapshot.orderItems.map((item) => item.id));
              setData(snapshot);
              setError('');
            }
          } catch (err) {
            if (activeBranchRef.current === targetBranch) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }

          if (!trailingRefreshRef.current || !activeBranchRef.current || document.hidden) break;
          targetBranch = activeBranchRef.current;
        }
      } finally {
        inFlightRef.current = false;
      }
    })();

    loadCyclePromiseRef.current = cycle;
    void cycle.finally(() => {
      if (loadCyclePromiseRef.current === cycle) loadCyclePromiseRef.current = null;
    });
    return cycle;
  }, []);

  useEffect(() => {
    activeBranchRef.current = branchId;
    if (!branchId) {
      watchedOrderIdsRef.current = new Set();
      visibleItemIdsRef.current = new Set();
      setData(EMPTY_POS_REALTIME);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Never expose the previous branch snapshot or relevance ids under a newly selected branch.
    watchedOrderIdsRef.current = new Set();
    visibleItemIdsRef.current = new Set();
    setData(EMPTY_POS_REALTIME);
    setError('');
    setLoading(true);
    load(branchId).finally(() => { if (!cancelled) setLoading(false); });
    const scheduleRefresh = () => {
      if (eventRefreshTimerRef.current !== null) return;
      eventRefreshTimerRef.current = window.setTimeout(() => {
        eventRefreshTimerRef.current = null;
        void load(branchId);
      }, 150);
    };
    const unsubscribe = subscribePosRealtime({
      branchId,
      onEvent: scheduleRefresh,
      shouldRefresh: (event) =>
        posRealtimeEventMatchesWatchedOrders(
          event,
          watchedOrderIdsRef.current,
          visibleItemIdsRef.current,
        ),
    });
    return () => {
      cancelled = true;
      if (eventRefreshTimerRef.current !== null) {
        window.clearTimeout(eventRefreshTimerRef.current);
        eventRefreshTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [branchId, load]);

  const applyTransferSnapshot = useCallback((snapshot: PosItemTransferSnapshot) => {
    if (!snapshot.orders.length || snapshot.orders.some((order) => order.branch_id !== activeBranchRef.current)) return;
    mutationRevisionRef.current += 1;
    setData((current) => {
      const next = mergeItemTransferSnapshot(current, snapshot, activeBranchRef.current);
      watchedOrderIdsRef.current = new Set(next.watchedOrderIds);
      visibleItemIdsRef.current = new Set(next.orderItems.map((item) => item.id));
      return next;
    });
  }, []);

  return { data, loading, error, applyTransferSnapshot };
}
