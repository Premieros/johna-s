import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('dashboard standby activity bar contract', () => {
  it('places the standby bar before the period controls and removes the standalone welcome block', () => {
    const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');
    const standbyIndex = dashboard.indexOf('<DashboardStandbyBar');
    const rangeIndex = dashboard.indexOf("bg-gradient-to-br");
    expect(standbyIndex).toBeGreaterThan(0);
    expect(rangeIndex).toBeGreaterThan(standbyIndex);
    expect(dashboard).not.toContain("Welcome back,");
    expect(dashboard).not.toContain("مرحباً، ${user?.full_name");
  });

  it('keeps the bar read-only, branch-aware and permission-first', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');
    expect(standby).toContain("can('audit.view')");
    expect(standby).toContain(".from('audit_log')");
    expect(standby).toContain(".eq('branch_id', branchFilter)");
    expect(standby).not.toContain("cloud_print_jobs");
    expect(standby).not.toContain("process_sale");
    expect(standby).not.toContain("send_to_kitchen");
    expect(standby).not.toContain(".insert(");
    expect(standby).not.toContain(".update(");
    expect(standby).not.toContain(".delete(");
  });

  it('queues new activity and slides it inside a fixed standby viewport without layout shift', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');
    const css = read('src/features/dashboard/dashboardCompact.css');
    expect(standby).toContain('const DISPLAY_MS = 4200');
    expect(standby).toContain('const SLIDE_MS = 280');
    expect(standby).toContain('setQueue((current) => [...current, ...fresh])');
    expect(standby).toContain('setShowEvent(false)');
    expect(standby).toContain('translate-x-full');
    expect(standby).toContain('-translate-x-full');
    expect(standby).toContain('dashboard-standby-viewport');
    expect(standby).toContain('<MiniCalendar now={now} ar={ar} />');
    expect(standby).toContain('dashboard-standby:last-read:');
    expect(css).toContain('contain: layout paint');
    expect(css).toContain('dashboard-standby-slide-layer');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('keeps the welcome readable and uses vivid high-contrast data colors', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');
    expect(standby).toContain("user?.full_name");
    expect(standby).toContain("مرحباً،");
    expect(standby).toContain('break-words');
    expect(standby).not.toContain('truncate text-xl font-black');
    expect(standby).toContain('bg-black');
    expect(standby).toContain('text-[#67e8f9]');
    expect(standby).toContain('text-[#ffd166]');
    expect(standby).toContain('bg-[#ff315f]');
    expect(standby).toContain('to="/pos"');
    expect(standby).toContain("إنشاء بيع");
  });
});
