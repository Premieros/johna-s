import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const dashboard = readFileSync('src/features/dashboard/pages/DashboardDataPage.tsx', 'utf8');
describe('dashboard sales analysis placement', () => {
  it('replaces the deleted welcome/activity strip with one sales chart above period controls', () => {
    expect(existsSync('src/features/dashboard/components/DashboardStandbyBar.tsx')).toBe(false);
    expect(dashboard).not.toContain('DashboardStandbyBar');
    const analysis = dashboard.indexOf('data-testid="dashboard-sales-analysis"');
    expect(analysis).toBeGreaterThan(0);
    expect(analysis).toBeLessThan(dashboard.indexOf('data-testid={`dashboard-range-'));
    expect(dashboard.match(/<DashboardSalesChart /g)).toHaveLength(1);
  });
  it('uses existing sales permission, data, error and loading state without extra reads', () => {
    expect(dashboard).toContain('{canViewSales && <section data-testid="dashboard-sales-analysis"');
    expect(dashboard).toContain('loading || salesUnavailable ? null : current.sales');
    expect(dashboard).toContain('current.sales / current.orders');
    expect(dashboard).not.toContain('loadActivity');
    expect(dashboard).not.toContain("audit_log");
  });
});
