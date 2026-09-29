import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src';

const legacyDirectConnectivityAllowlist = new Set([
  'src/context/OfflineContext.tsx',
  'src/core/offline/syncEngine.ts',
  'src/features/pos/components/topbar/PosTopBar.tsx',
  'src/features/pos/hooks/useCartAwareAvailability.ts',
  'src/features/pos/hooks/usePosOrder.ts',
  'src/features/pos/pages/PosWorkspacePage.tsx',
  'src/features/pos/services/cloudPrint.ts',
  'src/features/pos/services/payment.ts',
]);

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      result.push(...sourceFiles(absolute));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    result.push(relative('.', absolute).split(sep).join('/'));
  }
  return result;
}

describe('runtime connectivity boundary', () => {
  it('prevents new direct navigator.onLine checks outside the known legacy boundary', () => {
    const offenders = sourceFiles(ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('navigator.onLine') && !legacyDirectConnectivityAllowlist.has(path);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps OfflineContext backed by the canonical sync engine', () => {
    const context = readFileSync('src/context/OfflineContext.tsx', 'utf8');
    const engine = readFileSync('src/core/offline/syncEngine.ts', 'utf8');

    expect(context).toContain("offlineSyncEngine");
    expect(context).toContain("offlineSyncEngine.subscribe");
    expect(engine).toContain("navigator.onLine");
    expect(engine).toContain("isSyncing");
  });
});
