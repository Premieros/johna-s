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

  const load = useCallback(async (requestedBranch: string) => {
    if (!requestedBranch) return;

    // A kitchen send/order update can emit several Realtime events together.
    // Never launch overlapping full snapshots; keep one trailing refresh so the
    // final server state is still observed after the burst settles.
    if (inFlightRef.current) {
      trailingRefreshRef.current = true;
      return;
    }

    inFlightRef.current = true;
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
  }, []);

  useEffect(() => {
    activeBranchRef.current = branchId;
    if (!branchId) {
      setData(EMPTY_POS_REALTIME);
      setLoading(false);
      return;
    }
    let cancelled = false;
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
