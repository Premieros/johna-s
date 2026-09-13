import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('stabilization contracts', () => {
  it('shows every canonically authorized branch without a role-name bypass', () => {
    const migration = read('supabase/migrations/20260914010500_branch_access_select_rls.sql');

    expect(migration).toContain('public.user_may_access_branch(id)');
    expect(migration).toContain('public.is_platform_admin()');
    expect(migration).not.toMatch(/role\s*=|role_name|super_admin/i);
  });

  it('allows negative raw material only for POS auto-production while manual production remains strict', () => {
    const migration = read('supabase/migrations/20260914010600_pos_auto_production_negative_raw.sql');

    expect(migration).toContain("COALESCE(p_notes, '') = 'AUTO_SALE_PRODUCTION'");
    expect(migration).toContain('v_allow_negative_raw');
    expect(migration).toContain("RAISE EXCEPTION 'INSUFFICIENT_RAW_MATERIAL_STOCK");
    expect(migration).not.toContain('v_allow_negative_raw boolean := true');
  });

  it('retires the legacy Components page and surfaces reusable modifier groups', () => {
    const routes = read('src/app/routes.tsx');
    const menu = read('src/core/navigation/menu.config.ts');

    expect(existsSync('src/features/catalog/pages/ComponentsPage.tsx')).toBe(false);
    expect(routes).not.toContain("import('../features/catalog/pages/ComponentsPage')");
    expect(routes).toContain('<Route path={APP_ROUTES.components} element={<Navigate to={APP_ROUTES.products} replace />} />');
    expect(menu).not.toContain("id: 'components'");
    expect(menu).toContain("ar: 'مجموعات الموديفاير'");
    expect(menu).toContain("en: 'Modifier Groups'");
  });

  it('keeps mobile checkout visible and inside the phone safe area', () => {
    const mobileCss = read('src/mobile-layer-fix.css');

    expect(mobileCss).toContain('.hidden:has([data-testid="pos-payment-confirm"])');
    expect(mobileCss).toContain('height: 100dvh');
    expect(mobileCss).toContain('env(safe-area-inset-bottom)');
    expect(mobileCss).toContain('input[data-testid^="pos-split-payment-"]');
  });
});
