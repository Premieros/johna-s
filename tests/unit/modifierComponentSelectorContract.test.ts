import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/catalog/pages/ProductModifiersPage.tsx', 'utf8');

describe('modifier component selector contract', () => {
  it('loads raw materials and manufactured inventory units for the active branch', () => {
    expect(source).toContain("supabase.from('raw_materials').select('id,name,branch_id').eq('branch_id', branchFilter)");
    expect(source).toContain("api.catalog.listInventoryUnits({ branch_id: branchFilter, is_active: true })");
  });

  it('renders raw/manufactured selectors and persists inventory effects', () => {
    expect(source).toContain('<option value="raw_material">{isAr ? \'خامة\' : \'Raw material\'}</option>');
    expect(source).toContain('<option value="inventory_unit">{isAr ? \'مصنع\' : \'Manufactured item\'}</option>');
    expect(source).toContain('inventory_effects: row.inventory_effects');
    expect(source).toContain('addInventoryEffect(index)');
  });

  it('rejects incomplete inventory effects before save', () => {
    expect(source).toContain("!effect.target_id || !Number.isFinite(effect.quantity_delta) || effect.quantity_delta === 0");
  });
});
