import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/catalog/pages/ProductModifiersPage.tsx', 'utf8');

describe('modifier component selector contract', () => {
  it('loads reusable component groups for the active branch', () => {
    expect(source).toContain("api.catalog.listInventoryUnits({ branch_id: branchFilter, unit_type: 'manufactured', is_active: true })");
    expect(source).toContain('setComponentGroups((units || []) as InventoryUnit[])');
  });

  it('uses component-group choices without exposing technical inventory selectors', () => {
    expect(source).toContain("target_type: 'inventory_unit'");
    expect(source).toContain('source_unit_id: unit.id');
    expect(source).toContain('name: unit.name');
    expect(source).not.toContain('<option value="raw_material">');
    expect(source).not.toContain("isAr ? 'مصنع' : 'Manufactured item'");
  });

  it('keeps inventory effects valid and non-zero before save', () => {
    expect(source).toContain('if (option.inventory_effects.length === 0)');
    expect(source).toContain("inventory_effects: option.inventory_effects");
    expect(source).toContain('quantity_delta: 1');
  });
});
