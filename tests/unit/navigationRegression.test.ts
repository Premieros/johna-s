import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_ITEMS } from '@/core/navigation/menu.config';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = join(dir, entry.name);
  if (entry.name === 'node_modules' || entry.name === 'dist') return [];
  if (entry.isDirectory()) return sourceFiles(full);
  return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
});

describe('navigation regressions', () => {
  it('keeps dashboard KPI and report links mapped to intended destinations', () => {
    const source = read('src/features/dashboard/pages/VisualDashboardPage.tsx');
    expect(source).toContain('reportType=sales');
    expect(source).toContain('reportType=sales_by_payment');
    expect(source).toContain('reportType=sales_by_product');
    expect(source).toContain('reportType=detailed_invoices');
    expect(source).toContain('to="/inventory"');
    expect(source).toContain('setCompareEnabled');
    expect(source).toContain('setFilterOpen');
    expect(source).not.toContain('sales_by_branch');
    expect(source).not.toContain('/pos/active');
  });

  it('keeps POS entry tables-first with one real landing header and no legacy bottom navigation', () => {
    const landing = read('src/features/pos/components/tables/PosTablesSidebar.tsx');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(landing).toContain('data-testid="pos-tables-landing-actions"');
    expect(landing).toContain('data-testid="pos-start-quick-order"');
    expect(landing).toContain('data-testid="pos-tables-start-delivery"');
    expect(landing).toContain('data-testid="pos-tables-start-drive-thru"');
    expect(landing).toContain('data-testid="pos-tables-active-orders"');
    expect(workspace).toContain('onStartDelivery={() =>');
    expect(workspace).toContain("setStartStep('delivery')");
    expect(workspace).toContain("setStartStep('car')");
    expect(workspace).toContain("setPanel('orders')");
    expect(workspace).toContain("new Event('pos:show-tables-landing')");
    expect(workspace).not.toContain('PosBottomNav');
    expect(workspace).not.toContain('pb-[calc(56px+env(safe-area-inset-bottom))]');
    expect(workspace).not.toContain('bottom-[calc(56px+env(safe-area-inset-bottom)+8px)]');
  });

  it('uses one shared shell and declarative navigation configuration', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('MENU_ITEMS');
    expect(layout).toContain('APP_ROUTES');
    expect(layout).toContain('MENU_GROUPS');
    expect(layout).toContain('navigate(APP_ROUTES.floorPlan)');
    expect(layout).toContain("can('floor_plan.view')");
    expect(layout).toContain("user?.role === 'super_admin'");
    expect(MENU_ITEMS.length).toBeGreaterThan(0);
  });

  it('keeps legacy navigation aliases backed by canonical route constants', () => {
    const routes = read('src/app/routes.tsx');
    expect(routes).toContain('APP_ROUTES.accounting');
    expect(routes).toContain('APP_ROUTES.employees');
    expect(routes).toContain('APP_ROUTES.financialReports');
    expect(routes).toContain('APP_ROUTES.users');
    expect(APP_ROUTES.accounting).toBe('/accounting');
    expect(APP_ROUTES.employees).toBe('/employees');
  });

  it('rejects obvious dead navigation placeholders across the application', () => {
    const files = sourceFiles(resolve(root, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/href\s*=\s*["']#|to\s*=\s*["']#|javascript:/i.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('sidebar uses logical inline positioning for RTL/LTR correctness', () => {
    const layout = read('src/components/Layout.tsx');
    expect(layout).toContain('data-testid="app-sidebar"');
    expect(layout).toContain('fixed top-0 bottom-0 start-0');
    expect(layout).toContain('border-e');
    expect(layout).toContain("desktopSidebarHidden ? 'lg:start-0' : 'lg:start-[260px]'");
    expect(layout).toContain("desktopSidebarHidden ? 'lg:ms-0' : 'lg:ms-[260px]'");
    expect(layout).toContain('data-testid="desktop-sidebar-toggle"');
    expect(layout).toContain('data-testid="desktop-sidebar-hide"');
    expect(layout).not.toMatch(/fixed[^`]*\bright-0\b/);
    expect(layout).not.toMatch(/fixed[^`]*\bleft-0\b/);
  });
});