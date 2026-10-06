export const KITCHEN_ACTIVE_SECONDS = 40 * 60;

// Queue created_at is the authoritative kitchen-send timestamp returned by the RPC.
export function kitchenElapsedSeconds(item: { created_at: string; elapsed_seconds: number }, now: number): number {
  const sentAt = Date.parse(item.created_at);
  return Number.isFinite(sentAt) ? Math.max(0, Math.floor((now - sentAt) / 1000)) : Math.max(0, item.elapsed_seconds);
}

export function isKitchenQueueExpired(item: { created_at: string; elapsed_seconds: number }, now: number): boolean {
  return kitchenElapsedSeconds(item, now) >= KITCHEN_ACTIVE_SECONDS;
}
