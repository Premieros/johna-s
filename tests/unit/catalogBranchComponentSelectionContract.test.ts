import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const modifiersPage = readFileSync(resolve(root, 'src/features/catalog/pages/ProductModifiersPage.tsx'), 'utf8');
const setupWizard = readFileSync(resolve(root, 'src/features/catalog/pages/ProductSetupWizardPage.tsx'), 'utf8');
const inventoryUnitsPage = readFileSync(resolve(root, 'src/features/catalog/pages/InventoryUnitsPage.tsx'), 'utf8');
const pricingPage = readFileSync(resolve(root, 'src/features/catalog/pages/PricingPage.tsx'), 'utf8');

describe('catalog branch/component selection contracts', () => {
  it('keeps reusable modifier administration scoped to one active branch', () => {
    expect(modifiersPage).toContain('const branchFilter = useBranchFilter()');
    expect(modifiersPage).toContain('if (!branchFilter)');
    expect(modifiersPage).toContain("supabase.from('products').select('*').eq('branch_id', branchFilter)");
    expect(modifiersPage).toContain('api.catalog.listModifierGroupsAdmin(branchFilter)');
    expect(modifiersPage).toContain('p_branch_id: branchFilter');
    expect(modifiersPage).toContain('product_ids: string[]');
    expect(modifiersPage).toContain('toggleProduct');
    expect(modifiersPage).not.toContain('selectedProduct.branch_id');
  });

  it('loads reusable-group and raw-material component choices from the selected product branch only', () => {
    expect(setupWizard).toContain("supabase.from('inventory_units').select('*').eq('branch_id', branchId).eq('unit_type', 'manufactured').eq('is_active', true)");
    expect(setupWizard).toContain("supabase.from('raw_materials')");
    expect(setupWizard).toContain("measurement_unit:measurement_units!raw_materials_unit_id_fkey(id,name,symbol,code)");
    expect(setupWizard).toContain(".eq('branch_id', branchId)");
    expect(setupWizard).toContain(".eq('is_active', true)");
    expect(setupWizard).toContain("item.branch_id === branchId && item.unit_type === 'manufactured'");
    expect(setupWizard).toContain('material.branch_id === branchId');
  });

  it('never creates raw materials or reusable groups inline while adding a product', () => {
    expect(setupWizard).not.toContain("from('inventory_units').insert");
    expect(setupWizard).not.toContain("from('raw_materials').insert");
    expect(setupWizard).not.toContain('Create new unit');
    expect(setupWizard).not.toContain('إنشاء وحدة جديدة');
    expect(setupWizard).toContain('api.catalog.createProduct');
    expect(setupWizard).toContain("from('recipes').insert");
    expect(setupWizard).toContain("from('recipe_items').insert");
  });

  it('presents legacy manufactured inventory units as reusable component groups without production permission', () => {
    expect(inventoryUnitsPage).toContain("title={isAr ? 'مجموعات المكونات' : 'Component Groups'}");
    expect(inventoryUnitsPage).toContain("can('raw_materials.manage')");
    expect(inventoryUnitsPage).not.toContain("can('production.manage')");
    expect(inventoryUnitsPage).toContain('عند بيع منتج مرتبط بها، يتم خصم الخامات عند إرسال الطلب للمطبخ');
    expect(setupWizard).toContain("['2', isAr ? 'مجموعات المكونات' : 'Component groups']");
    expect(setupWizard).toContain('الخصم الفعلي للخامات يتم عند إرسال الطلب للمطبخ');
    expect(pricingPage).toContain("manufactured: { label: ar ? 'مجموعات المكونات' : 'Component groups'");
    expect(pricingPage).toContain('تم حفظ تسعير مجموعة المكونات');
  });
});
