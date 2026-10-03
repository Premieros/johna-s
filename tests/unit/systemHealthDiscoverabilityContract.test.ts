import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settings = readFileSync('src/features/admin/pages/SettingsControlCenterPage.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');
const routeDefs = readFileSync('src/core/navigation/routes.ts', 'utf8');

describe('System Health discoverability contract', () => {
  it('shows a visible Settings link for System Health / Branch Pulse', () => {
    expect(settings).toContain('data-testid="settings-system-health-link"');
    expect(settings).toContain('to={APP_ROUTES.systemHealth}');
    expect(settings).toContain('صحة النظام / نبضة الفروع');
    expect(settings).toContain('System Health / Branch Pulse');
  });

  it('keeps the canonical route and permission boundary unchanged', () => {
    expect(routeDefs).toContain("systemHealth: '/system-health'");
    expect(routes).toContain('<Route path={APP_ROUTES.systemHealth}');
    expect(routes).toContain('permission="settings.manage"');
    expect(routes).toContain('<SystemHealthPage />');
  });
});
