import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const productBrowser = fs.readFileSync('src/features/pos/components/catalog/ProductBrowser.tsx', 'utf8');
const orderBar = fs.readFileSync('src/features/pos/components/order/PosOrderHeaderBar.tsx', 'utf8');
const topBar = fs.readFileSync('src/features/pos/components/topbar/PosTopBar.tsx', 'utf8');

describe('compact POS action visibility', () => {
  it('shows product configuration on small screens', () => {
    expect(productBrowser).toContain('title={isAr ? \'تخصيص الصنف\' : \'Configure Item\'} className="flex h-9 w-9');
    expect(productBrowser).not.toContain('Configure Item\'} className="hidden h-9 w-9');
  });

  it('keeps critical order action labels visible', () => {
    expect(orderBar).toContain("<span>{isAr ? 'دمج / نقل' : 'Merge / Transfer'}</span>");
    expect(orderBar).toContain("<span>{isAr ? 'طباعة' : 'Print'}</span>");
    expect(orderBar).toContain("<span>{isAr ? 'تعليق' : 'Hold'}</span>");
  });

  it('surfaces compact-layout navigation actions', () => {
    expect(topBar).toContain("onPanel('tables')");
    expect(topBar).toContain("onPanel('kitchen')");
    expect(topBar).toContain("className=\"flex min-h-9 min-w-9 items-center justify-center rounded-xl text-ui-muted");
    expect(topBar).toContain("{isAr ? 'طلب جديد' : 'New'}");
  });

  it('exposes language/theme quick actions and permission-gated settings shortcuts', () => {
    expect(topBar).toContain('data-testid="pos-language-action"');
    expect(topBar).toContain("setLang(isAr ? 'en' : 'ar')");
    expect(topBar).toContain('data-testid="pos-theme-action"');
    expect(topBar).toContain('toggleTheme()');
    expect(topBar).toContain("can('settings.manage')");
    expect(topBar).toContain('?tab=business_day');
    expect(topBar).toContain('?tab=appearance');
    expect(topBar).toContain('?tab=language');
  });
});
