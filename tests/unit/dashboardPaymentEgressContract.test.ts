import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync('src/features/dashboard/pages/DashboardDataPage.tsx', 'utf8');
const visual = readFileSync('src/features/dashboard/pages/VisualDashboardPage.tsx', 'utf8');
const loader = readFileSync('src/features/dashboard/services/dashboardPayments.ts', 'utf8');

describe('dashboard payment egress contract', () => {
  it('removes oversized raw sale_payments requests from active dashboard pages', () => {
    for (const source of [dashboard, visual]) {
      expect(source).not.toContain("from('sale_payments')");
      expect(source).not.toContain('.limit(20000)');
      expect(source).toContain('loadDashboardPaymentAggregates');
    }
  });

  it('prefers the canonical sales-by-payment report RPC', () => {
    expect(loader).toContain('reporting.getSalesByPaymentReport');
    expect(loader).toContain('p_payment_method: null');
    expect(loader).toContain('p_order_type: orderType || null');
  });

  it('keeps a bounded compatibility fallback for sales-view-only users', () => {
    expect(loader).toContain('const PAYMENT_ID_CHUNK_SIZE = 100;');
    expect(loader).toContain('const PAYMENT_CHUNK_CONCURRENCY = 4;');
    expect(loader).toContain("from('sale_payments')");
    expect(loader).toContain('.limit(5000)');
    expect(loader).toContain('aggregatePaymentMethods(sales, paymentRows)');
  });

  it('does not add a new dashboard database migration dependency', () => {
    expect(loader).not.toContain('apply_migration');
    expect(loader).not.toContain('create function');
  });
});
