import { useSyncExternalStore } from 'react';

export interface CartAvailabilitySnapshot {
  branchId: string;
  map: Record<string, number> | null;
  checking: boolean;
  error: string | null;
}

const EMPTY: CartAvailabilitySnapshot = {
  branchId: '',
  map: null,
  checking: false,
  error: null,
};

let snapshot: CartAvailabilitySnapshot = EMPTY;
const listeners = new Set<() => void>();

export function setCartAvailabilitySnapshot(next: CartAvailabilitySnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getCartAvailabilitySnapshot() {
  return snapshot;
}

export function resetCartAvailabilitySnapshot(branchId = '') {
  setCartAvailabilitySnapshot({ ...EMPTY, branchId });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCartAvailabilitySnapshot() {
  return useSyncExternalStore(subscribe, getCartAvailabilitySnapshot, getCartAvailabilitySnapshot);
}
