import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const catalogSource = readFileSync(resolve(repoRoot, 'src/api/domains/catalog.ts'), 'utf8');
const modifiersSource = readFileSync(resolve(repoRoot, 'src/features/catalog/pages/ProductModifiersPage.tsx'), 'utf8');
const kitchenSource = readFileSync(resolve(repoRoot, 'src/features/catalog/pages/KitchenStationsPage.tsx'), 'utf8');

const currentDirectRpcTargets = [
  'get_product_modifiers_admin',
  'list_modifier_groups_admin',
  'save_modifier_group',
  'get_kitchen_station_assignments',
  'get_kitchen_station_editor_context',
  'save_kitchen_station_assignments',
] as const;

describe('catalog RPC boundary contract (PR3 6D)', () => {
  it('keeps current catalog page RPC targets behind src/api', () => {
    for (const rpcName of currentDirectRpcTargets) {
      expect(catalogSource).toContain(`rpc('${rpcName}'`);
      expect(modifiersSource).not.toContain(`supabase.rpc('${rpcName}'`);
      expect(kitchenSource).not.toContain(`supabase.rpc('${rpcName}'`);
    }
  });

  it('routes reusable modifier-group admin calls through catalog API while preserving response validation', () => {
    expect(modifiersSource).toContain('api.catalog.listModifierGroupsAdmin(branchFilter)');
    expect(modifiersSource).toContain('if (groupsResult.error) throw groupsResult.error');
    expect(modifiersSource).toContain('const result = (groupsResult.data || {}) as AdminGroupsResponse');
    expect(modifiersSource).toContain('api.catalog.saveModifierGroup({');
    expect(modifiersSource).toContain("if (!result.success) throw new Error(result.detail || result.error || 'SAVE_MODIFIER_FAILED')");
  });

  it('routes kitchen assignment calls through catalog API while preserving response validation', () => {
    expect(kitchenSource).toContain('catalog.getKitchenStationAssignments(selectedBranchId)');
    expect(kitchenSource).toContain('catalog.getKitchenStationEditorContext(selectedBranchId)');
    expect(kitchenSource).toContain('catalog.saveKitchenStationAssignments({');
    expect(kitchenSource).toContain("if (!res?.success) throw new Error(res?.error || 'ASSIGNMENTS_LOAD_FAILED')");
    expect(kitchenSource).toContain("if (!context?.success) throw new Error(context?.error || 'EDITOR_CONTEXT_LOAD_FAILED')");
    expect(kitchenSource).toContain("if (!res?.success) throw new Error(res?.error || 'ASSIGNMENT_SAVE_FAILED')");
  });

  it('does not recreate the two obsolete RecipesPage RPC call sites removed from the current source tree', () => {
    expect(modifiersSource).not.toContain('update_recipe_with_items');
    expect(modifiersSource).not.toContain('delete_recipe_controlled');
    expect(kitchenSource).not.toContain('update_recipe_with_items');
    expect(kitchenSource).not.toContain('delete_recipe_controlled');
  });
});