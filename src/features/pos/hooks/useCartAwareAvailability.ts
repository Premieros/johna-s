import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';
import type { CartItem, OrderItem } from '@/lib/types';
import { fetchBranchWarehouseId } from '../services/payment';
import type { OrderKitchenSend } from '../types';
import { computeUnsentCartDemand } from '../utils/cartAvailability';
import {
  resetCartAvailabilitySnapshot,
  setCartAvailabilitySnapshot,
} from '../services/cartAvailabilityStore';

interface UseCartAwareAvailabilityInput {
  branchId: string;
  activeOrderId: string | null;
  cart: CartItem[];
}

export interface CartAwareAvailabilityResult {
  map: Record<string, number> | null;
  checking: boolean;
  error: string | null;
  canAdd: (productId: string, quantity: number) => boolean;
  markMutationPending: () => void;
}

export function useCartAwareAvailability({ branchId, activeOrderId, cart }: UseCartAwareAvailabilityInput): CartAwareAvailabilityResult {
  const [map, setMap] = useState<Record<string, number> | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<Record<string, number> | null>(null);
  const generation = useRef(0);
  const mutationPending = useRef(false);

  const publish = useCallback((next: { map: Record<string, number> | null; checking: boolean; error: string | null }) => {
    mapRef.current = next.map;
    setMap(next.map);
    setChecking(next.checking);
    setError(next.error);
    setCartAvailabilitySnapshot({ branchId, ...next });
  }, [branchId]);

  const clear = useCallback(() => {
    mapRef.current = null;
    setMap(null);
    setChecking(false);
    setError(null);
    resetCartAvailabilitySnapshot(branchId);
  }, [branchId]);

  const markMutationPending = useCallback(() => {
    mutationPending.current = true;
    publish({ map: mapRef.current, checking: true, error: null });
  }, [publish]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let cancelled = false;

    if (!branchId || cart.length === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      mutationPending.current = false;
      clear();
      return () => { cancelled = true; };
    }

    publish({ map: mapRef.current, checking: true, error: null });

    void (async () => {
      try {
        let orderItems: OrderItem[] = [];
        let kitchenSends: OrderKitchenSend[] = [];
        if (activeOrderId) {
          const [itemsResult, sendsResult] = await Promise.all([
            supabase.from('order_items').select('*').eq('order_id', activeOrderId),
            supabase.from('order_kitchen_sends').select('*').eq('order_id', activeOrderId),
          ]);
          if (itemsResult.error) throw itemsResult.error;
          if (sendsResult.error) throw sendsResult.error;
          orderItems = (itemsResult.data || []) as OrderItem[];
          kitchenSends = (sendsResult.data || []) as OrderKitchenSend[];
        }

        const demand = computeUnsentCartDemand(cart, orderItems, kitchenSends);
        if (demand.length === 0) {
          if (!cancelled && generation.current === currentGeneration) {
            mutationPending.current = false;
            clear();
          }
          return;
        }

        const warehouseId = await fetchBranchWarehouseId(branchId, activeOrderId);
        if (!warehouseId) throw new Error('WAREHOUSE_REQUIRED');

        const { data, error: rpcError } = await supabase.rpc('get_pos_cart_product_availability', {
          p_branch_id: branchId,
          p_warehouse_id: warehouseId,
          p_items: demand,
          p_cap: 100000,
        });
        if (rpcError) throw rpcError;

        const nextMap: Record<string, number> = {};
        for (const row of (data || []) as { product_id: string; available_quantity: number | string }[]) {
          nextMap[row.product_id] = Math.max(0, Number(row.available_quantity) || 0);
        }
        if (!cancelled && generation.current === currentGeneration) {
          mutationPending.current = false;
          publish({ map: nextMap, checking: false, error: null });
        }
      } catch (caught) {
        if (!cancelled && generation.current === currentGeneration) {
          mutationPending.current = false;
          publish({
            map: null,
            checking: false,
            error: caught instanceof Error ? caught.message : String(caught),
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeOrderId, branchId, cart, clear, publish]);

  useEffect(() => () => resetCartAvailabilitySnapshot(''), []);

  const canAdd = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) return true;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
    if (mutationPending.current || checking || error) return false;
    if (!map) return true;
    return Number(map[productId] || 0) + 0.0000001 >= quantity;
  }, [checking, error, map]);

  return { map, checking, error, canAdd, markMutationPending };
}
