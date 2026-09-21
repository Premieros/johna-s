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

  it('keeps canonical Main Area identities fixed while allowing a per-branch active table count', () => {
    const baseline = read('supabase/migrations/20260920170000_fixed_main_dining_area_and_english_tables.sql');
    const configurable = read('supabase/migrations/20260921090000_branch_main_area_table_limit.sql');

    expect(baseline).toContain("name = 'Main Area'");
    expect(baseline).toContain("'Table ' || lpad(v_i::text, 2, '0')");
    expect(baseline).toContain('idx_dining_areas_one_default_per_branch');
    expect(baseline).toContain('DEFAULT_AREA_FIXED_50');
    expect(baseline).toContain('DEFAULT_DINING_TABLE_FIXED');
    expect(baseline).toContain('trg_guard_default_dining_area_delete');
    expect(baseline).toContain('trg_guard_default_dining_table_identity');

    expect(configurable).toContain('main_area_table_count');
    expect(configurable).toContain('private.default_dining_table_limit');
    expect(configurable).toContain('FOR v_i IN 1..50 LOOP');
    expect(configurable).toContain('is_active = (v_i <= v_limit)');
    expect(configurable).toContain('MAIN_AREA_TABLE_LIMIT_BUSY');
    expect(configurable).toContain('trg_sync_main_area_table_count');
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
