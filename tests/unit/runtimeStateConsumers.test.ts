import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('runtime state UI consumers', () => {
  it('uses canonical runtimeState in the compact offline indicator', () => {
    const source = readFileSync('src/components/OfflineStatusIndicator.tsx', 'utf8');
    expect(source).toContain('runtimeState');
    expect(source).toContain("runtimeState.state === 'blocked'");
    expect(source).toContain("runtimeState.state === 'degraded'");
  });

  it('uses canonical runtimeState in the sync center status card while retaining legacy execution guards', () => {
    const source = readFileSync('src/components/OfflineSyncCenterModal.tsx', 'utf8');
    expect(source).toContain('runtimeState');
    expect(source).toContain("runtimeState.state === 'syncing'");
    expect(source).toContain('disabled={!isOnline || isSyncing || pendingCount === 0}');
  });
});
