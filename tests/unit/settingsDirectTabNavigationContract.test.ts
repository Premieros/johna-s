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
});
