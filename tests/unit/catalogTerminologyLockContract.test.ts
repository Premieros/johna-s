import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('catalog terminology and measurement-unit lock contract', () => {
  it('keeps raw-material measurement unit editable only on create', () => {
    const source = read('src/features/manufacturing/pages/RawMaterialsPage.tsx');

    expect(source).toContain('raw-material-measurement-unit-create');
    expect(source).toContain('raw-material-measurement-unit-locked');
    expect(source).toContain("Measurement unit is intentionally immutable after creation");
    expect(source).toContain(".update(commonPayload).eq('id', form.id)");
    expect(source).toContain("insert({ ...commonPayload, unit_id: form.unit_id })");
  });

  it('presents inventory units as manufactured items without changing the storage contract', () => {
    const source = read('src/features/catalog/pages/InventoryUnitsPage.tsx');
    const menu = read('src/core/navigation/menu.config.ts');

    expect(source).toContain("unit_type: 'manufactured' as const");
    expect(source).toContain("title={isAr ? 'المصنعات' : 'Manufactured Items'}");
    expect(source).not.toContain('<option value="ready">');
    expect(menu).toContain("label: { ar: 'المصنعات', en: 'Manufactured Items' }");
  });

  it('keeps product creation free of product measurement units and links only manufactured inventory items', () => {
    const source = read('src/features/catalog/pages/ProductSetupWizardPage.tsx');

    expect(source).toContain(".eq('unit_type', 'manufactured')");
    expect(source).toContain("['2', isAr ? 'المصنعات' : 'Manufactured items']");
    expect(source).toContain('Products do not have measurement units.');
    expect(source).not.toContain("'وحدات المنتج'");
    expect(source).not.toContain("'Product units'");
  });
});
