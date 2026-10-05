import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { fetchOrderSettlementPreview, type OrderSettlementPreview } from '../services/settlementPreview';

/** A preview is valid only for the exact order/branch that requested it. */
export function useScopedSettlementPreview(orderId: string | null, branchId: string | null) {
  const scope = useRef({ orderId, branchId, generation: 0 });
  const currentPreview = useRef<OrderSettlementPreview | null>(null);
  const [snapshot, setSnapshot] = useState<OrderSettlementPreview | null>(null);
  useLayoutEffect(() => {
    scope.current = { orderId, branchId, generation: scope.current.generation + 1 };
    currentPreview.current = null;
    setSnapshot(null);
    return () => { scope.current.generation += 1; currentPreview.current = null; };
  }, [orderId, branchId]);

  const clear = useCallback(() => { scope.current.generation += 1; currentPreview.current = null; setSnapshot(null); }, []);
  const load = useCallback(async () => {
    if (!orderId || !branchId || scope.current.orderId !== orderId || scope.current.branchId !== branchId) return { preview: null, error: null };
    const generation = ++scope.current.generation;
    currentPreview.current = null;
    const result = await fetchOrderSettlementPreview(orderId);
    if (generation !== scope.current.generation) return { preview: null, error: null };
    if (result.preview && (result.preview.order_id !== orderId || result.preview.branch_id !== branchId)) {
      setSnapshot(null);
      return { preview: null, error: 'SETTLEMENT_PREVIEW_SCOPE_MISMATCH' };
    }
    currentPreview.current = result.preview;
    setSnapshot(result.preview);
    return result;
  }, [orderId, branchId]);
  const preview = snapshot?.order_id === orderId && snapshot.branch_id === branchId ? snapshot : null;
  const isCurrent = useCallback((value: OrderSettlementPreview) => currentPreview.current === value, []);
  return { preview, load, clear, isCurrent };
}
