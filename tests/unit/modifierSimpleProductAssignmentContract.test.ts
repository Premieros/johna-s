import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/features/catalog/pages/ProductModifiersPage.tsx', 'utf8');
const optionsPage = readFileSync('src/features/catalog/pages/ProductModifierOptionsPage.tsx', 'utf8');
const posModal = readFileSync('src/features/pos/components/catalog/ProductConfigModal.tsx', 'utf8');

describe('reusable modifier group UI contract', () => {
  it('edits real reusable groups with multiple options and Min/Max', () => {
    expect(page).toContain('min_selections: number');
    expect(page).toContain('max_selections: number');
    expect(page).toContain('options: ModifierOptionRow[]');
    expect(page).toContain('options: group.options.map');
    expect(page).toContain('p_product_ids: group.product_ids');
  });

  it('assigns each group to products with search/filter/bulk selection', () => {
    expect(page).toContain('product_ids: string[]');
    expect(page).toContain('toggleProduct');
    expect(page).toContain('productSearch');
    expect(page).toContain('categoryFilter');
    expect(page).toContain('تحديد نتائج البحث');
    expect(page).toContain('المختار فقط');
  });

  it('backs normal options with component groups by same name', () => {
    expect(page).toContain("unit_type: 'manufactured'");
    expect(page).toContain('source_unit_id: unit.id');
    expect(page).toContain('name: unit.name');
    expect(page).toContain("target_type: 'inventory_unit'");
    expect(page).toContain('quantity_delta: 1');
    expect(optionsPage).toContain('لا توجد عملية تصنيع أو إنتاج هنا');
  });

  it('keeps the POS rendering only option names with simple selection guidance', () => {
    expect(posModal).toContain('isAr ? option.name : option.name_en || option.name');
    expect(posModal).toContain('modifier-option-${option.id}');
    expect(posModal).not.toContain('isAr ? group.name : group.name_en || group.name');
    expect(posModal).toContain('اختياري — حتى');
    expect(posModal).toContain('اختر من');
  });

  it('translates open-order modifier guards instead of exposing raw codes', () => {
    expect(page).toContain("error === 'MODIFIER_GROUP_HAS_OPEN_ORDERS'");
    expect(page).toContain('لا يمكن تعديل أو إيقاف هذه المجموعة الآن لأن أحد منتجاتها موجود في طلب مفتوح');
    expect(page).toContain("error === 'REQUIRED_MODIFIER_HAS_OPEN_ORDERS'");
  });
});
