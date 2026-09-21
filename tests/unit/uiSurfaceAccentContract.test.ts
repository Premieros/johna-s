import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('UI surface accent and typography contract', () => {
  it('uses comfortable neutral page/surface tokens instead of pure white or pure black', () => {
    const css = read('src/index.css');

    expect(css).toContain('--ui-surface: 252 252 253;');
    expect(css).toContain('--ui-page: 245 247 250;');
    expect(css).toContain('--ui-surface: 24 27 33;');
    expect(css).toContain('--ui-page: 17 19 24;');

    expect(css).not.toContain('--ui-surface: 255 255 255;');
    expect(css).not.toContain('--ui-page: 0 0 0;');
  });

  it('provides reusable semantic tints without colored card edge strips', () => {
    const css = read('src/index.css');

    expect(css).toContain('linear-gradient(135deg, rgb(var(--ui-accent-strip) / 0.045)');
    expect(css).not.toContain('.ui-accent-card::before');
    expect(css).not.toContain('.ui-accent-top::before');
    expect(css).not.toContain('inset-inline-start: 0;');
    expect(css).toContain('.ui-accent-primary');
    expect(css).toContain('.ui-accent-purchase');
    expect(css).toContain('.ui-accent-inventory');
    expect(css).toContain('.ui-accent-finance');
    expect(css).toContain('.ui-accent-alert');
    expect(css).toContain('.ui-accent-system');
    expect(css.indexOf('.ui-accent-neutral')).toBeLessThan(css.indexOf('.ui-accent-primary'));
  });

  it('keeps Cairo for RTL, Inter for LTR and strengthens shared typography', () => {
    const css = read('src/index.css');
    const header = read('src/components/PageHeader.tsx');
    const panel = read('src/components/design/DesignPanel.tsx');

    expect(css).toContain("font-family: 'Inter', 'Cairo'");
    expect(css).toContain("font-family: 'Cairo', 'Inter'");
    expect(header).toContain('font-extrabold');
    expect(header).toContain('leading-6');
    expect(header).toContain('tabular-nums');
    expect(panel).toContain('font-extrabold');
  });

  it('applies accents to safe shared cards, filters, tables and dashboard surfaces', () => {
    const header = read('src/components/PageHeader.tsx');
    const design = read('src/components/design/DesignSurface.tsx');
    const tiles = read('src/components/design/CenterTile.tsx');
    const table = read('src/components/DataTable.tsx');
    const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');

    expect(header).toContain('ui-accent-card ui-accent-neutral');
    expect(design).toContain('ui-accent-card ui-accent-system');
    expect(tiles).toContain("accent?: 'primary' | 'purchase' | 'inventory' | 'finance' | 'alert' | 'system' | 'neutral'");
    expect(tiles).toContain("const accentClass = `ui-accent-${item.accent || 'primary'}`");
    expect(tiles).toContain('ui-accent-card ${accentClass}');
    expect(table).toContain('ui-accent-top ui-accent-neutral');
    expect(dashboard).toContain('ui-accent-finance');
    expect(dashboard).toContain('ui-accent-inventory');
    expect(dashboard).toContain('ui-accent-alert');
  });

  it('rolls semantic accents through safe inventory, purchase, finance, reports and admin surfaces', () => {
    const inventory = read('src/features/inventory/pages/InventoryCenterPage.tsx');
    const purchases = read('src/features/trade/pages/PurchasesPage.tsx');
    const treasury = read('src/features/accounting/pages/TreasuryPage.tsx');
    const financial = read('src/features/accounting/pages/FinancialReportsPage.tsx');
    const reportShell = read('src/features/reporting/ReportingShell.tsx');
    const reportFilter = read('src/features/reporting/ReportFilterBar.tsx');
    const reportCard = read('src/features/reporting/ReportCard.tsx');
    const users = read('src/features/admin/pages/UsersPage.tsx');
    const branches = read('src/features/admin/pages/BranchesPage.tsx');
    const approvals = read('src/features/admin/pages/ApprovalCenterPage.tsx');

    expect(inventory).toContain("accent: 'inventory'");
    expect(inventory).toContain('ui-accent-card ui-accent-inventory');
    expect(purchases).toContain('className="ui-accent-purchase"');
    expect(treasury).toContain('className="ui-accent-finance"');
    expect(financial).toContain('className="ui-accent-finance"');
    expect(reportShell).toContain('ui-accent-top ui-accent-system');
    expect(reportFilter).toContain('ui-accent-system');
    expect(reportCard).toContain('CATEGORY_ACCENTS');
    expect(reportCard).toContain("sales: 'ui-accent-primary'");
    expect(reportCard).toContain("inventory: 'ui-accent-inventory'");
    expect(reportCard).toContain("financial: 'ui-accent-finance'");
    expect(reportCard).toContain('break-words text-sm font-bold leading-5');
    expect(users).toContain('ui-accent-system');
    expect(branches).toContain('ui-accent-system');
    expect(approvals).toContain('ui-accent-system');
  });

  it('lets the dashboard consume the full available shell width without duplicate horizontal padding', () => {
    const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');
    const layout = read('src/components/Layout.tsx');

    expect(dashboard).toContain('w-full min-w-0 bg-ui-page');
    expect(dashboard).toContain('className="w-full min-w-0 space-y-5"');
    expect(dashboard).not.toContain('mx-auto max-w-[1560px]');
    expect(dashboard).not.toContain('bg-ui-page px-4 py-5 sm:px-7 sm:py-7');
    expect(layout).toContain("const fullWidthContent = location.pathname === APP_ROUTES.dashboard");
    expect(layout).toContain("fullWidthContent ? 'max-w-none' : 'mx-auto max-w-[1600px]'");
  });

  it('preserves the dashboard StandBy strip as intentional true black', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');

    expect(standby).toContain('bg-black');
    expect(standby).toContain('dashboard-standby-viewport');
  });
});
