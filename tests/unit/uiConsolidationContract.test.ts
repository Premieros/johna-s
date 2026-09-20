import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('UI consolidation contracts', () => {
  it('keeps navigation compact, persistent, and opens the active group automatically', () => {
    const layout = read('src/components/Layout.tsx');

    expect(layout).toContain("premier:nav-collapsed-groups");
    expect(layout).toContain('catalog: true');
    expect(layout).toContain('finance: true');
    expect(layout).toContain('admin: true');
    expect(layout).toContain('activeMenuGroup');
    expect(layout).toContain('[activeMenuGroup]: false');
  });

  it('keeps phone data cards concise with expandable secondary fields', () => {
    const table = read('src/components/DataTable.tsx');

    expect(table).toContain('mobilePriority?: boolean');
    expect(table).toContain('mobilePriorityColumns');
    expect(table).toContain('mobileSecondaryColumns');
    expect(table).toContain("details: 'التفاصيل'");
    expect(table).toContain('<details');
    expect(table).toContain('{labels.details}');
  });

  it('uses the canonical page hierarchy for settings and a touch-friendly section rail', () => {
    const settings = read('src/features/admin/pages/SettingsControlCenterPage.tsx');

    expect(settings).toContain("import { Card, PageHeader } from '@/components/PageHeader'");
    expect(settings).toContain('<PageHeader');
    expect(settings).toContain('data-testid="settings-section-rail"');
    expect(settings).toContain('overflow-x-auto');
  });

  it('renders reports as compact cards on phones and full tables above phone size', () => {
    const reports = read('src/features/reporting/pages/ReportsPage.tsx');

    expect(reports).toContain('reportMobilePrimaryColumns');
    expect(reports).toContain('reportMobileSecondaryColumns');
    expect(reports).toContain('data-testid="reports-mobile-results"');
    expect(reports).toContain('sm:hidden');
    expect(reports).toContain('hidden overflow-x-auto sm:block');
  });

  it('collapses floating phone utilities behind one control while preserving desktop utilities', () => {
    const utilities = read('src/components/PageUtilityControls.tsx');

    expect(utilities).toContain('data-testid="page-utility-toggle"');
    expect(utilities).toContain('data-testid="page-utility-menu"');
    expect(utilities).toContain('sm:hidden');
    expect(utilities).toContain('sm:flex sm:flex-col');
  });

  it('standardizes repeated row and toolbar action styles', () => {
    const css = read('src/index.css');
    const table = read('src/components/DataTable.tsx');

    expect(css).toContain('.ui-icon-action');
    expect(css).toContain('.ui-icon-action-info');
    expect(css).toContain('.ui-icon-action-danger');
    expect(css).toContain('.ui-toolbar-action');
    expect(table).toContain('className="ui-toolbar-action"');
  });

  it('does not keep the obsolete pre-257 phone cart selector', () => {
    const mobileCss = read('src/mobile-layer-fix.css');

    expect(mobileCss).not.toContain('div.lg\\:hidden.fixed.inset-0.z-40:has(> div.absolute.inset-0.bg-black\\/50)');
    expect(mobileCss).toContain('[data-testid="pos-mobile-order-sheet"]');
  });
});
