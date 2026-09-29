import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('offline runtime state integration', () => {
  it('exposes the canonical runtime state from OfflineContext', () => {
    const context = readFileSync('src/context/OfflineContext.tsx', 'utf8');

    expect(context).toContain("deriveRuntimeOperationalState");
    expect(context).toContain("runtimeState: RuntimeStateSnapshot");
    expect(context).toContain("runtimeState,");
    expect(context).toContain("getAllOfflineSales()");
  });

  it('keeps legacy online/syncing fields for backward-compatible consumers', () => {
    const context = readFileSync('src/context/OfflineContext.tsx', 'utf8');

    expect(context).toContain("isOnline: boolean");
    expect(context).toContain("isSyncing: boolean");
    expect(context).toContain("pendingCount: number");
  });
});
