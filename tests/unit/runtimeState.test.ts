import { describe, expect, it } from 'vitest';
import { deriveRuntimeOperationalState } from '@/core/offline/runtimeState';
import type { SyncStatus } from '@/core/offline/syncEngine';

const base: SyncStatus = {
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
  lastError: null,
  syncedRecentlyCount: 0,
};

describe('runtime operational state', () => {
  it('is online when connected and clear', () => {
    expect(deriveRuntimeOperationalState(base, []).state).toBe('online');
  });

  it('is offline when network is unavailable and no blocked items exist', () => {
    expect(deriveRuntimeOperationalState({ ...base, isOnline: false }, []).state).toBe('offline');
  });

  it('is syncing while an online replay is running', () => {
    expect(deriveRuntimeOperationalState({ ...base, isSyncing: true, pendingCount: 2 }, [{ status: 'syncing' }]).state).toBe('syncing');
  });

  it('is degraded for retryable pending/failed work or a non-blocking sync error', () => {
    expect(deriveRuntimeOperationalState({ ...base, pendingCount: 1 }, [{ status: 'pending' }]).state).toBe('degraded');
    expect(deriveRuntimeOperationalState(base, [{ status: 'failed' }]).state).toBe('degraded');
    expect(deriveRuntimeOperationalState({ ...base, lastError: 'TEMP_ERROR' }, []).state).toBe('degraded');
  });

  it('is blocked when blocked/dead-letter work needs intervention', () => {
    expect(deriveRuntimeOperationalState(base, [{ status: 'blocked' }]).state).toBe('blocked');
    expect(deriveRuntimeOperationalState({ ...base, isOnline: false }, [{ status: 'dead_letter' }]).state).toBe('blocked');
  });
});
