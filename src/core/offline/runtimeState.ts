import type { SyncStatus } from './syncEngine';
import type { OfflineSaleQueueItem } from './offlineStorage';

export type RuntimeOperationalState = 'online' | 'degraded' | 'offline' | 'syncing' | 'blocked';

export type RuntimeStateSnapshot = {
  state: RuntimeOperationalState;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  blockedCount: number;
  lastError: string | null;
};

export function deriveRuntimeOperationalState(
  sync: SyncStatus,
  queue: Pick<OfflineSaleQueueItem, 'status'>[],
): RuntimeStateSnapshot {
  const blockedCount = queue.filter((item) => item.status === 'blocked' || item.status === 'dead_letter').length;
  const failedCount = queue.filter((item) => item.status === 'failed').length;

  let state: RuntimeOperationalState;
  if (!sync.isOnline) {
    state = blockedCount > 0 ? 'blocked' : 'offline';
  } else if (blockedCount > 0) {
    state = 'blocked';
  } else if (sync.isSyncing) {
    state = 'syncing';
  } else if (failedCount > 0 || sync.pendingCount > 0 || Boolean(sync.lastError)) {
    state = 'degraded';
  } else {
    state = 'online';
  }

  return {
    state,
    isOnline: sync.isOnline,
    isSyncing: sync.isSyncing,
    pendingCount: sync.pendingCount,
    failedCount,
    blockedCount,
    lastError: sync.lastError,
  };
}
