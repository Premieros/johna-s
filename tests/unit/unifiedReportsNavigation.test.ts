import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const menu = readFileSync('src/core/navigation/menu.config.ts', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const palette = readFileSync('src/components/CommandPalette.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');

describe('unified reports navigation permissions', () => {
  it('exposes one reports menu destination for operational or financial permission', () => {
    expect(menu).toContain("id: 'reports'");
    expect(menu).toContain("permissionsAny: ['reports.view', 'reports.financial']");
    expect(menu).not.toContain("id: 'financial-reports'");
  });

  it('supports any-of permissions consistently in sidebar and command palette', () => {
    expect(layout).toContain('item.permissionsAny.some((permission) => can(permission))');
    expect(palette).toContain('item.permissionsAny.some((permission) => can(permission))');
  });

  it('allows /reports for either reports.view or reports.financial while preserving the legacy financial alias', () => {
    expect(routes).toContain('permissionsAny={["reports.view", "reports.financial"]}');
    expect(routes).toContain('APP_ROUTES.financialReports');
    expect(routes).toContain('permission="reports.financial"><ReportsCenterPage');
  });
});
