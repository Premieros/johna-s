import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loader = readFileSync('src/components/PageProgressLoader.tsx', 'utf8');
const app = readFileSync('src/app/App.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');
const workAuthorization = readFileSync('src/features/admin/work-authorization/WorkAuthorizationAppBoundary.tsx', 'utf8');

describe('global page progress loader contract', () => {
  it('shows a visible percentage instead of a blank screen or spinner-only fallback', () => {
    expect(loader).toContain("data-testid="page-progress-loader"");
    expect(loader).toContain('{Math.round(progress)}%');
    expect(loader).toContain("data-testid="page-load-fallback"");
    expect(routes).not.toContain('animate-spin rounded-full h-10 w-10');
  });

  it('starts from zero, advances while loading and completes at 100 only when loading finishes', () => {
    expect(loader).toContain('setProgress(0)');
    expect(loader).toContain('Math.min(92, next)');
    expect(loader).toContain('setProgress(100)');
    expect(loader).toContain('context?.begin()');
    expect(loader).toContain('context?.complete()');
  });

  it('keeps the provider outside route fallbacks so completion can remain visible briefly', () => {
    expect(app).toContain('<PageLoadProgressProvider>');
    expect(app).toContain('<AppRoutes />');
    expect(routes).toContain('<Suspense fallback={<PageLoadFallback />}>');
  });

  it('uses the same fallback while auth, roles and branch authorization are loading', () => {
    expect(routes).toContain('if (loading || rolesLoading) return <PageLoadFallback />;');
    expect(workAuthorization).toContain('if (branchesLoading && !branchId)');
    expect(workAuthorization).toContain('return <PageLoadFallback />;');
    expect(workAuthorization).not.toContain('animate-spin rounded-full border-b-2 border-ui-primary');
  });

  it('keeps bilingual reassuring loading copy', () => {
    expect(loader).toContain('جارٍ تجهيز الصفحة');
    expect(loader).toContain('النظام يعمل، لحظات ويتم عرض المحتوى.');
    expect(loader).toContain('Preparing your page');
  });
});
