import type { OrderServiceDetails } from './types';

let pendingServiceDetails: OrderServiceDetails | null = null;

export function setPendingServiceDetails(details: OrderServiceDetails): void {
  pendingServiceDetails = { ...details };
}

export function getPendingServiceDetails(): OrderServiceDetails | null {
  return pendingServiceDetails ? { ...pendingServiceDetails } : null;
}

export function clearPendingServiceDetails(): void {
  pendingServiceDetails = null;
}
