import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync('src/features/dashboard/pages/DashboardDataPage.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');

describe('dashboard recovery and navigation density', () => {
  it('keeps server timeout failures explicit and offers a shorter range without claiming zero sales', () => {
    expect(dashboard).toContain("failure.code === '57014'");
    expect(dashboard).toContain("setSalesUnavailable(true)");
    expect(dashboard).toContain("setSalesTimedOut(timedOut)");
    expect(dashboard).toContain("onClick={() => setRange('month')}");
    expect(dashboard).toContain("salesTimedOut && range !== 'month'");
    expect(dashboard).toContain("role=\"alert\"");
  });

  it('does not reserve a full chart height while sales are unavailable', () => {
    expect(dashboard).toContain("loading || (!salesUnavailable && current.orders > 0)");
    expect(dashboard).toContain("'min-h-16'");
  });

  it('shows page tabs on mobile or when the desktop sidebar is collapsed, without desktop duplicates', () => {
    expect(layout).toContain("desktopSidebarHidden ? '' : 'lg:hidden'");
    expect(layout).toContain('data-testid="section-workspace-tabs"');
    expect(layout).toContain('data-testid={`sidebar-nav-item-${item.id}`}');
  });
});
