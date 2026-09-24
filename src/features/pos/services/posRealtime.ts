import { supabase } from '@/api';

export type PosRealtimeTable =
  | 'orders'
  | 'dining_tables'
  | 'order_items'
  | 'order_kitchen_sends';

export interface PosRealtimeEvent {
  table: PosRealtimeTable;
  eventType: string;
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
}

export interface PosRealtimeOptions {
  branchId: string;
  onEvent: () => void;
  shouldRefresh?: (event: PosRealtimeEvent) => boolean;
  debounceMs?: number;
}

interface ListenerRegistration {
  onEvent: () => void;
  shouldRefresh?: (event: PosRealtimeEvent) => boolean;
}

interface SharedChannel {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<ListenerRegistration>;
  pendingListeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  debounceMs: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toEvent(table: PosRealtimeTable, payload: unknown): PosRealtimeEvent {
  const source = asRecord(payload);
  return {
    table,
    eventType: typeof source.eventType === 'string' ? source.eventType : '',
    newRow: asRecord(source.new),
    oldRow: asRecord(source.old),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

/**
 * order_items has no branch_id, so its Realtime subscription cannot be scoped
 * server-side by branch. Match inserts/updates by order_id and deletes by the
 * locally known item id (default replica identity may only expose the PK in OLD).
 * Unknown payload shapes fail open so correctness wins over optimization.
 */
export function posRealtimeEventMatchesWatchedOrders(
  event: PosRealtimeEvent,
  watchedOrderIds: ReadonlySet<string>,
  visibleItemIds: ReadonlySet<string>,
): boolean {
  if (event.table !== 'order_items') return true;

  const orderId =
    stringField(event.newRow, 'order_id') ||
    stringField(event.oldRow, 'order_id');
  if (orderId) return watchedOrderIds.has(orderId);

  const itemId =
    stringField(event.newRow, 'id') ||
    stringField(event.oldRow, 'id');
  if (itemId) return visibleItemIds.has(itemId);

  return true;
}

// One realtime channel per branch, ref-counted. Server-side branch filters remain
// on tables that carry branch_id; order_items relevance is filtered per listener.
const sharedChannels = new Map<string, SharedChannel>();

function getSharedChannel(branchId: string, debounceMs: number): SharedChannel {
  const existing = sharedChannels.get(branchId);
  if (existing) return existing;

  const entry: SharedChannel = {
    channel: null as never,
    listeners: new Set(),
    pendingListeners: new Set(),
    timer: null,
    debounceMs,
  };

  const trigger = (event: PosRealtimeEvent) => {
    for (const listener of entry.listeners) {
      if (!listener.shouldRefresh || listener.shouldRefresh(event)) {
        entry.pendingListeners.add(listener.onEvent);
      }
    }
    if (entry.pendingListeners.size === 0) return;

    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const pending = [...entry.pendingListeners];
      entry.pendingListeners.clear();
      pending.forEach((listener) => listener());
    }, entry.debounceMs);
  };

  entry.channel = supabase
    .channel(`pos-realtime-${branchId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
      (payload) => trigger(toEvent('orders', payload)),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dining_tables', filter: `branch_id=eq.${branchId}` },
      (payload) => trigger(toEvent('dining_tables', payload)),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      (payload) => trigger(toEvent('order_items', payload)),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_kitchen_sends', filter: `branch_id=eq.${branchId}` },
      (payload) => trigger(toEvent('order_kitchen_sends', payload)),
    )
    .subscribe();

  sharedChannels.set(branchId, entry);
  return entry;
}

export function subscribePosRealtime({
  branchId,
  onEvent,
  shouldRefresh,
  debounceMs = 300,
}: PosRealtimeOptions): () => void {
  const entry = getSharedChannel(branchId, debounceMs);
  const registration: ListenerRegistration = { onEvent, shouldRefresh };
  entry.listeners.add(registration);

  return () => {
    entry.listeners.delete(registration);
    entry.pendingListeners.delete(onEvent);
    if (entry.listeners.size === 0) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.pendingListeners.clear();
      void supabase.removeChannel(entry.channel);
      sharedChannels.delete(branchId);
    }
  };
}
