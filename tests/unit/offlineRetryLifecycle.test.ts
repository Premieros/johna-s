import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OFFLINE_RETRY_BASE_MS,
  OFFLINE_RETRY_MAX_MS,
  OFFLINE_RETRY_MAX_ATTEMPTS,
  offlineRetryDelayMs,
} from '@/core/offline/offlineStorage';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('offline outbox retry lifecycle', () => {
  it('uses exponential bounded retry delays', () => {
    expect(OFFLINE_RETRY_BASE_MS).toBe(30_000);
    expect(OFFLINE_RETRY_MAX_ATTEMPTS).toBe(6);
    expect(offlineRetryDelayMs(1)).toBe(30_000);
    expect(offlineRetryDelayMs(2)).toBe(60_000);
    expect(offlineRetryDelayMs(3)).toBe(120_000);
    expect(offlineRetryDelayMs(20)).toBe(OFFLINE_RETRY_MAX_MS);
  });

  it('keeps automatic retries quiet for blocked/dead-letter rows and honors next_retry_at', () => {
    const sync = read('src/core/offline/syncEngine.ts');

    expect(sync).toContain("item.status === 'blocked' || item.status === 'dead_letter'");
    expect(sync).toContain('item.next_retry_at');
    expect(sync).toContain('Date.parse(item.next_retry_at)');
    expect(sync).toContain('await scheduleOfflineSaleRetry(item.id, errorMsg)');
    expect(sync).toContain('await blockOfflineSale(item.id, ownerError)');
  });

  it('keeps manual/reconnect recovery available without creating a second queue', () => {
    const sync = read('src/core/offline/syncEngine.ts');
    const context = read('src/context/OfflineContext.tsx');

    expect(sync).toContain('syncAll(options: { force?: boolean } = {})');
    expect(sync).toContain('if (options.force) return true');
    expect(sync).toContain('void this.syncAll({ force: true })');
    expect(context).toContain('offlineSyncEngine.syncAll({ force: true })');
  });

  it('keeps terminal rows visible for operator review instead of deleting them', () => {
    const storage = read('src/core/offline/offlineStorage.ts');
    const modal = read('src/components/OfflineSyncCenterModal.tsx');

    expect(storage).toContain("'dead_letter'");
    expect(storage).toContain('dead_lettered_at');
    expect(storage).toContain('OFFLINE_RETRY_MAX_ATTEMPTS');
    expect(modal).toContain("item.status === 'dead_letter'");
    expect(modal).toContain("item.status === 'blocked'");
    expect(modal).toContain('item.retry_count');
  });
});
