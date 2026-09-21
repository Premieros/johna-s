import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActiveOrders, EMPTY_POS_REALTIME } from '../services/posOrders';
import { subscribePosRealtime } from '../services/posRealtime';
import type { PosRealtimeData } from '../types';

export interface UsePosRealtimeResult {
  data: PosRealtimeData;
  loading: boolean;
  error: string;
}

export function usePosRealtime(branchId: string): UsePosRealtimeResult {
  const [data, setData] = useState<PosRealtimeData>(EMPTY_POS_REALTIME);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeBranchRef = useRef(branchId);
  const inFlightRef = useRef(false);
  const trailingRefreshRef = useRef(false);
  const loadCyclePromiseRef = useRef<Promise<void> | null>(null);

  const load = useCallback((requestedBranch: string): Promise<void> => {
    if (!requestedBranch) return Promise.resolve();

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
            const snapshot = await fetchActiveOrders(targetBranch);
            if (activeBranchRef.current === targetBranch) {
              setData(snapshot);
              setError('');
            }
          } catch (err) {
            if (activeBranchRef.current === targetBranch) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }

          if (!trailingRefreshRef.current || !activeBranchRef.current) break;
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
      setData(EMPTY_POS_REALTIME);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Never expose the previous branch snapshot under a newly selected branch.
    setData(EMPTY_POS_REALTIME);
    setError('');
    setLoading(true);
    load(branchId).finally(() => { if (!cancelled) setLoading(false); });
    const unsubscribe = subscribePosRealtime({
      branchId,
      onEvent: () => { void load(branchId); },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [branchId, load]);

  return { data, loading, error };
}
