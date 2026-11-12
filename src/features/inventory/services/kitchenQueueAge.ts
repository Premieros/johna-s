export const KITCHEN_OVERDUE_SECONDS = 40 * 60;
export const KITCHEN_AUTO_CLOSE_SECONDS = 60 * 60;

// get_kitchen_queue returns the latest send timestamp for each order/station card.
// This makes a newly sent addition restart only the display-age window.
export function kitchenElapsedSeconds(item: { created_at: string; elapsed_seconds: number }, now: number): number {
  const sentAt = Date.parse(item.created_at);
  return Number.isFinite(sentAt) ? Math.max(0, Math.floor((now - sentAt) / 1000)) : Math.max(0, item.elapsed_seconds);
}

export function isKitchenQueueOverdue(item: { created_at: string; elapsed_seconds: number }, now: number): boolean {
  return kitchenElapsedSeconds(item, now) >= KITCHEN_OVERDUE_SECONDS;
}

export function isKitchenQueueAutoClosed(item: { created_at: string; elapsed_seconds: number }, now: number): boolean {
  return kitchenElapsedSeconds(item, now) >= KITCHEN_AUTO_CLOSE_SECONDS;
}
