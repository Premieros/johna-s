import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pos = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const prefetch = readFileSync('src/core/navigation/prefetch.ts', 'utf8');

describe('navigation and POS performance contracts', () => {
  it('hydrates the branch-scoped POS cache before online catalog refresh', () => {
    const cacheIndex = pos.indexOf('const cachedData = await loadCachedPosData');
    const networkIndex = pos.indexOf('const [pRes, cRes, catRes, aRes] = await Promise.allSettled');
    expect(cacheIndex).toBeGreaterThan(-1);
    expect(networkIndex).toBeGreaterThan(cacheIndex);
    expect(pos).toContain('setProducts(cachedProducts)');
    expect(pos).toContain('setLoading(false)');
    expect(pos).toContain('if (cachedProducts.length > 0) return;');
  });

  it('keeps route prefetch user-intent driven instead of eager-loading every page', () => {
    expect(layout).toContain('prefetchAppRoute(item.route)');
    expect(layout).toContain('onTouchStart={() => prefetchAppRoute(item.route)}');
    expect(layout).toContain('onPointerEnter={() => prefetchAppRoute(item.route)}');
    expect(prefetch).toContain('const prefetched = new Set<string>()');
    expect(prefetch).not.toContain('Promise.all');
  });
});
