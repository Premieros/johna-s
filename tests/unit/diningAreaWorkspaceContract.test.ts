import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('dining area workspace and language lock contract', () => {
  it('shows every dining area as a POS table filter and keeps Main Area first', () => {
    const sidebar = read('src/features/pos/components/tables/PosTablesSidebar.tsx');
    const drawer = read('src/features/pos/components/tables/TablesPanel.tsx');
    const chooser = read('src/features/pos/components/tables/TableSelectModal.tsx');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(sidebar).toContain('data-testid="pos-table-area-tabs"');
    expect(sidebar).toContain('area.is_default');
    expect(sidebar).toContain('table.area_id === selectedAreaId');
    expect(drawer).toContain('data-testid="pos-table-drawer-area-tabs"');
    expect(chooser).toContain('orderedAreas.find((area) => area.is_default)');
    expect(workspace).toContain('areas={diningAreas}');
    expect(workspace).toContain("table: 'dining_areas'");
    expect(workspace).toContain('pos-dining-areas-');
  });

  it('keeps the canonical Main Area fixed at English Table 01..Table 50', () => {
    const migration = read('supabase/migrations/20260920170000_fixed_main_dining_area_and_english_tables.sql');

    expect(migration).toContain("name = 'Main Area'");
    expect(migration).toContain("'Table ' || lpad(v_i::text, 2, '0')");
    expect(migration).toContain('idx_dining_areas_one_default_per_branch');
    expect(migration).toContain('DEFAULT_AREA_FIXED_50');
    expect(migration).toContain('DEFAULT_DINING_TABLE_FIXED');
    expect(migration).toContain('trg_guard_default_dining_area_delete');
    expect(migration).toContain('trg_guard_default_dining_table_identity');
  });

  it('uses canonical floor-plan RPCs for table creation and updates', () => {
    const api = read('src/api/domains/floorPlan.ts');
    const activeOrders = read('src/features/pos/pages/ActiveOrdersPage.tsx');

    expect(api).toContain("'floor_plan_add_table'");
    expect(api).toContain("'floor_plan_update_table'");
    expect(activeOrders).toContain('api.floorPlan.addTable');
    expect(activeOrders).toContain('api.floorPlan.updateTable');
    expect(activeOrders).not.toContain("supabase.from('dining_tables').insert(payload)");
    expect(activeOrders).not.toContain("supabase.from('dining_tables').update(payload)");
  });

  it('exposes an explicit language lock control in Settings', () => {
    const context = read('src/context/LanguageContext.tsx');
    const settings = read('src/features/admin/pages/SettingsControlCenterPage.tsx');

    expect(context).toContain('languageLocked');
    expect(context).toContain('lockLanguagePreference');
    expect(context).toContain('unlockLanguagePreference');
    expect(settings).toContain('data-testid="language-lock-button"');
    expect(settings).toContain('languageLocked ?');
  });
});
