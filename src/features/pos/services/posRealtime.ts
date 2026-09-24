import { supabase } from '@/api';

export type PosRealtimeTable = 'orders' | 'dining_tables' | 'order_items' | 'order_kitchen_sends';

export interface PosRealtimeEvent {
  table: PosRealtimeTable;
  eventType: string;
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
}

export interface PosRealtimeOptions {
  branchId: string;
  onEvent: (events: PosRealtimeEvent[]) => void;
  debounceMs?: number;
}

interface SharedChannel {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<(events: PosRealtimeEvent[]) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  debounceMs: number;
  pendingEvents: PosRealtimeEvent[];
}

function normalizeEvent(
  table: PosRealtimeTable,
  payload: unknown,
): PosRealtimeEvent {
  const row = (payload || {}) as {
    eventType?: string;
    new?: Record<string, unknown> | null;
    old?: Record<string, unknown> | null;
  };
  return {
    table,
    eventType: row.eventType || '',
    newRow: row.new || {},
    oldRow: row.old || {},
  };
}

export function posRealtimeEventsAffectWatchedOrders(
  events: PosRealtimeEvent[],
  watchedOrderIds: Iterable<string>,
  watchedItemIds: Iterable<string>,
  hasSnapshot = true,
): boolean {
  if (!hasSnapshot) return true;

  const orderIds = new Set(watchedOrderIds);
  const itemIds = new Set(watchedItemIds);

  return events.some((event) => {
    if (event.table !== 'order_items') return true;

    const orderId =
      (typeof event.newRow.order_id === 'string' && event.newRow.order_id) ||
      (typeof event.oldRow.order_id === 'string' && event.oldRow.order_id) ||
      null;
    if (orderId && orderIds.has(orderId)) return true;

    const itemId =
      (typeof event.newRow.id === 'string' && event.newRow.id) ||
      (typeof event.oldRow.id === 'string' && event.oldRow.id) ||
      null;
    return !!itemId && itemIds.has(itemId);
  });
}

// One realtime channel per branch, ref-counted, so multiple consumers
// (Top Bar badge, Active Orders Center, workspace summary) never create
// duplicate subscriptions.
const sharedChannels = new Map<string, SharedChannel>();

function getSharedChannel(branchId: string, debounceMs: number): SharedChannel {
  const existing = sharedChannels.get(branchId);
  if (existing) return existing;

  const entry: SharedChannel = {
    channel: null as never,
    listeners: new Set(),
    timer: null,
    debounceMs,
    pendingEvents: [],
  };

  const trigger = (table: PosRealtimeTable, payload: unknown) => {
    entry.pendingEvents.push(normalizeEvent(table, payload));
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const batch = entry.pendingEvents;
      entry.pendingEvents = [];
      entry.listeners.forEach((listener) => listener(batch));
    }, entry.debounceMs);
  };

  entry.channel = supabase
    .channel(`pos-realtime-${branchId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, (payload) => trigger('orders', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tables', filter: `branch_id=eq.${branchId}` }, (payload) => trigger('dining_tables', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, (payload) => trigger('order_items', payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_kitchen_sends', filter: `branch_id=eq.${branchId}` }, (payload) => trigger('order_kitchen_sends', payload))
    .subscribe();
  sharedChannels.set(branchId, entry);
  return entry;
}

export function subscribePosRealtime({ branchId, onEvent, debounceMs = 300 }: PosRealtimeOptions): () => void {
  const entry = getSharedChannel(branchId, debounceMs);
  entry.listeners.add(onEvent);

  return () => {
    entry.listeners.delete(onEvent);
    if (entry.listeners.size === 0) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.pendingEvents = [];
      void supabase.removeChannel(entry.channel);
      sharedChannels.delete(branchId);
    }
  };
}
