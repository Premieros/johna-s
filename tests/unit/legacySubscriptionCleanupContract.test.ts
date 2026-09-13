import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('PR7 legacy subscription cleanup contract', () => {
  it('removes legacy subscription routes from the canonical route registry and router', () => {
    const routes = APP_ROUTES as Record<string, string>;
    const routerSource = read('src/app/routes.tsx');

    expect(routes.subscription).toBeUndefined();
    expect(routes.subscriptions).toBeUndefined();
    expect(Object.values(routes)).not.toContain('/subscription');
    expect(Object.values(routes)).not.toContain('/subscriptions');
    expect(routerSource).not.toContain('APP_ROUTES.subscription');
    expect(routerSource).not.toContain('APP_ROUTES.subscriptions');
  });

  it('keeps navigation free of subscription or billing destinations', () => {
    expect(MENU_ITEMS.some((item) => item.id === 'subscription' || item.id === 'subscriptions')).toBe(false);
    expect(MENU_ITEMS.some((item) => item.route === '/subscription' || item.route === '/subscriptions')).toBe(false);
  });

  it('does not load subscription status during auth bootstrap', () => {
    const authSource = read('src/context/AuthContext.tsx');

    expect(authSource).not.toContain('SubscriptionStatus');
    expect(authSource).not.toContain('api.subscriptions');
    expect(authSource).not.toContain('refreshSubscription');
    expect(authSource).not.toContain('loadSubscriptionFor');
  });

  it('removes the legacy frontend subscription API and type exports', () => {
    const apiModules = read('src/api/modules.ts');
    const sharedTypes = read('src/lib/types.ts');

    expect(apiModules).not.toContain("./domains/subscriptions");
    expect(sharedTypes).not.toContain("./domains/types/subscription");
    expect(existsSync(resolve(root, 'src/api/domains/subscriptions.ts'))).toBe(false);
    expect(existsSync(resolve(root, 'src/lib/domains/types/subscription.ts'))).toBe(false);
  });

  it('removes dead subscription UI, hooks and service modules', () => {
    const removedPaths = [
      'src/features/subscription',
      'src/components/subscription',
      'src/services/subscription',
      'src/hooks/useSubscription.ts',
      'src/hooks/useFeatureAccess.ts',
      'src/features/admin/pages/SubscriptionsAdminPage.tsx',
    ];

    for (const path of removedPaths) {
      expect(existsSync(resolve(root, path)), `${path} should remain removed`).toBe(false);
    }
  });
});
