import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/admin/pages/SettingsControlCenterPage.tsx', 'utf8');

describe('settings direct-tab navigation', () => {
  it('supports deep links to shift, appearance, and language settings', () => {
    expect(source).toContain('useSearchParams');
    expect(source).toContain("initialTab === 'business_day'");
    expect(source).toContain("initialTab === 'appearance'");
    expect(source).toContain("initialTab === 'language'");
    expect(source).toContain("next.set('tab', tab)");
  });

  it('keeps the existing settings sections intact', () => {
    expect(source).toContain("key: 'business_day'");
    expect(source).toContain("key: 'appearance'");
    expect(source).toContain("key: 'language'");
  });

  it('provides explicit save actions for theme and language', () => {
    expect(source).toContain('data-testid="save-appearance-settings"');
    expect(source).toContain('data-testid="save-language-settings"');
    expect(source).toContain('saveSettings({ theme, brand_color: uiTheme })');
    expect(source).toContain('saveSettings({ language: lang })');
  });
});
