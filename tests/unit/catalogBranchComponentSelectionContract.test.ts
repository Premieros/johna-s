import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const modifiersPage = readFileSync(resolve(root, 'src/features/catalog/pages/ProductModifiersPage.tsx'), 'utf8');
const setupWizard = readFileSync(resolve(root, 'src/features/catalog/pages/ProductSetupWizardPage.tsx'), 'utf8');

describe('catalog branch/component selection contracts', () => {
  it('keeps modifier administration scoped to one active branch', () => {
    expect(modifiersPage).toContain('const branchFilter = useBranchFilter()');
    expect(modifiersPage).toContain(".eq('branch_id', branchFilter)");
    expect(modifiersPage).toContain('if (!branchFilter)');
    expect(modifiersPage).toContain('selectedProduct.branch_id !== branchFilter');
    expect(modifiersPage).toContain("branch_id: branchFilter, is_active: true");
  });

  it('loads manufactured and raw-material component choices from the selected product branch only', () => {
    expect(setupWizard).toContain(".from('inventory_units').select('*').eq('branch_id', branchId).eq('unit_type', 'manufactured').eq('is_active', true)");
    expect(setupWizard).toContain(".from('raw_materials').select('id,name,branch_id,is_active,default_cost').eq('branch_id', branchId).eq('is_active', true)");
    expect(setupWizard).toContain("item.branch_id === branchId && item.unit_type === 'manufactured'");
    expect(setupWizard).toContain('material.branch_id === branchId');
  });

  it('never creates raw materials or manufactured inventory items inline while adding a product', () => {
    expect(setupWizard).not.toContain("from('inventory_units').insert");
    expect(setupWizard).not.toContain("from('raw_materials').insert");
    expect(setupWizard).not.toContain('Create new unit');
    expect(setupWizard).not.toContain('إنشاء وحدة جديدة');
    expect(setupWizard).toContain("from('product_unit_links').insert");
    expect(setupWizard).toContain("from('recipes').insert");
    expect(setupWizard).toContain("from('recipe_items').insert");
  });
});
