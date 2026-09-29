import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/features/dashboard/pages/DashboardDataPage.tsx', 'utf8');
const service = readFileSync('src/features/dashboard/services/dashboardSnapshot.ts', 'utf8');
const rawData = readFileSync('src/features/dashboard/services/dashboardRawData.ts', 'utf8');

describe('dashboard bounded snapshot preference', () => {
  it('prefers one aggregate snapshot before the legacy raw-sales fallback', () => {
    expect(page).toContain('await loadDashboardSalesSnapshot({');
    expect(page).toContain('if (boundedSnapshot) {');
    expect(page).toContain('setSnapshot(boundedSnapshot)');
    expect(rawData).toContain(".from('sales')");
    expect(rawData).toContain("sale:sales!inner(created_at,branch_id)");
    expect(rawData).toContain(".gte('sale.created_at', params.currentFrom)");
    expect(rawData).toContain(".lte('sale.created_at', params.currentTo)");
    expect(rawData).toContain(".limit(5000)");
    expect(rawData).not.toContain(".in('sale_id', currentRows.map((sale) => sale.id))");

    const snapshotCall = page.indexOf('await loadDashboardSalesSnapshot({');
    expect(snapshotCall).toBeGreaterThanOrEqual(0);
    expect(page).toContain('loadDashboardFallbackSales({');
  });

  it('keeps dashboard financial semantics server-bounded and typed', () => {
    expect(service).toContain('reporting.getDashboardSalesSnapshot');
    expect(service).toContain("p_timezone: args.timezone || 'Africa/Cairo'");
    expect(service).toContain('paymentMethods: paymentRows(raw.payment_methods)');
    expect(service).toContain('previousPaymentMethods: paymentRows(raw.previous_payment_methods)');
    expect(service).toContain('topProducts:');
    expect(service).toContain('currentSeries:');
    expect(service).toContain('previousSeries:');
  });

  it('renders snapshot aggregates while preserving a compatibility fallback', () => {
    expect(page).toContain('if (snapshot) return snapshot.current');
    expect(page).toContain('if (snapshot) return snapshot.previous');
    expect(page).toContain('snapshot.orderTypes');
    expect(page).toContain('snapshot.topProducts');
    expect(page).toContain('snapshot.currentSeries');
    expect(page).toContain('snapshot.recentSales');
  });
});
