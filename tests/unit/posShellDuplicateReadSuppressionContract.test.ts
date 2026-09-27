import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const hook = readFileSync('src/features/pos/hooks/useActiveOrderCount.ts', 'utf8');

describe('POS shell duplicate-read suppression contract', () => {
  it('disables the shell badge reader on /pos and nested POS routes', () => {
    expect(layout).toContain('location.pathname === APP_ROUTES.pos');
    expect(layout).toContain('location.pathname.startsWith(`${APP_ROUTES.pos}/`)');
    expect(layout).toContain("useActiveOrderCount(branchFilter || user?.branch_id || '', !isPosRoute)");
  });

  it('returns from the effect before starting refresh or realtime when disabled', () => {
    const disabledGuard = hook.indexOf('if (!enabled) return;');
    const initialRefresh = hook.indexOf('void refresh(false);');
    const subscribe = hook.indexOf('const unsubscribe = subscribePosRealtime');

    expect(disabledGuard).toBeGreaterThan(-1);
    expect(initialRefresh).toBeGreaterThan(disabledGuard);
    expect(subscribe).toBeGreaterThan(disabledGuard);
  });

  it('keeps the lightweight non-POS implementation and excludes frozen paths', () => {
    expect(hook).toContain(".from('orders')");
    expect(hook).toContain(".from('order_items')");
    expect(hook).not.toContain('order_kitchen_sends');
    expect(hook).not.toContain('cloud_print_jobs');
    expect(hook).not.toContain('send_to_kitchen');
  });
});
