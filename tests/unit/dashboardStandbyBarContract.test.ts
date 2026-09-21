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

  it('queues new activity and returns to the calendar after a short minimal transition', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');
    const css = read('src/features/dashboard/dashboardCompact.css');
    expect(standby).toContain('const DISPLAY_MS = 4200');
    expect(standby).toContain('setQueue((current) => [...current, ...fresh])');
    expect(standby).toContain('setActive(null)');
    expect(standby).toContain('<MiniCalendar now={now} ar={ar} />');
    expect(standby).toContain('dashboard-standby:last-read:');
    expect(css).toContain('dashboard-standby-event-in');
    expect(css).toContain('180ms ease-out');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('merges the welcome name and new-sale action inside the standby bar', () => {
    const standby = read('src/features/dashboard/components/DashboardStandbyBar.tsx');
    expect(standby).toContain("user?.full_name");
    expect(standby).toContain("مرحباً،");
    expect(standby).toContain('to="/pos"');
    expect(standby).toContain("إنشاء بيع");
  });
});
