import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('lightweight application shell contract', () => {
  it('keeps the global layout off the full POS realtime snapshot', () => {
    const layout = read('src/components/Layout.tsx');
    const countHook = read('src/features/pos/hooks/useActiveOrderCount.ts');

    expect(layout).toContain('useActiveOrderCount');
    expect(layout).not.toContain('useActiveOrders(');
    expect(countHook).toContain(".select('id')");
    expect(countHook).toContain(".select('id,order_id,quantity')");
    expect(countHook).not.toContain('order_kitchen_sends');
    expect(countHook).not.toContain('dining_tables');
    expect(countHook).not.toContain('get_pos_order_operator_labels');
  });

  it('loads route-only controls only on their owning routes', () => {
    const app = read('src/app/App.tsx');

    expect(app).toContain("const FinancialVisibilityAdminControl = lazy(");
    expect(app).toContain("const PrinterSettingsLauncher = lazy(");
    expect(app).toContain('pathname === APP_ROUTES.superAdmin');
    expect(app).toContain('pathname.startsWith(APP_ROUTES.settings)');
    expect(app).toContain('<CloudPrintAgent />');
  });

  it('keeps recharts out of the dashboard data chunk', () => {
    const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');
    const chart = read('src/features/dashboard/components/DashboardSalesChart.tsx');

    expect(dashboard).not.toContain("from 'recharts'");
    expect(dashboard).toContain("lazy(() =>");
    expect(chart).toContain("from 'recharts'");
  });
});
