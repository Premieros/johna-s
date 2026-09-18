import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/features/catalog/pages/ProductModifiersPage.tsx', 'utf8');
const posModal = readFileSync('src/features/pos/components/catalog/ProductConfigModal.tsx', 'utf8');

describe('simple modifier product assignment contract', () => {
  it('uses one visible modifier name for both group and option payloads', () => {
    expect(page).toContain('name,\n        name_en: row.name_en.trim() || null');
    expect(page).toContain('options: [{');
    expect(page).toContain('name,\n          name_en: row.name_en.trim() || null');
    expect(page).toContain('max_selections: 1');
    expect(page).toContain('min_selections: 0');
  });

  it('assigns each modifier directly to selected products', () => {
    expect(page).toContain('product_ids: string[]');
    expect(page).toContain('toggleProduct');
    expect(page).toContain('p_product_ids: row.product_ids');
    expect(page).toContain('عيّن منتجًا واحدًا على الأقل للموديفاير');
  });

  it('keeps the POS rendering the option own name', () => {
    expect(posModal).toContain('isAr ? option.name : option.name_en || option.name');
    expect(posModal).toContain('modifier-option-${option.id}');
  });

  it('translates the open-order removal guard instead of exposing the raw code', () => {
    expect(page).toContain("result.error === 'MODIFIER_GROUP_HAS_OPEN_ORDERS'");
    expect(page).toContain('لا يمكن إزالة هذا الموديفاير الآن لأن منتجاته موجودة في طلبات مفتوحة');
  });
});
