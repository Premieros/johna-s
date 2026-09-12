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
    expect(source).toContain('api.catalog.createRawMaterial');
  });

  it('presents only manufactured inventory items and forces type only on create', () => {
    const source = read('src/features/catalog/pages/InventoryUnitsPage.tsx');
    const menu = read('src/core/navigation/menu.config.ts');

    expect(source).toContain("filters: [{ column: 'unit_type', value: 'manufactured' }]");
    expect(source).toContain(".update(payload).eq('id', editing.id)");
    expect(source).toContain("insert({ ...payload, unit_type: 'manufactured' as const })");
    expect(source).toContain("title={isAr ? 'المصنعات' : 'Manufactured Items'}");
    expect(source).not.toContain('<option value="ready">');
    expect(menu).toContain("label: { ar: 'المصنعات', en: 'Manufactured Items' }");
  });

  it('shows immutable raw measurement units when composing manufactured-item recipes', () => {
    const source = read('src/features/catalog/pages/InventoryUnitsPage.tsx');

    expect(source).toContain('measurement_unit:measurement_units!raw_materials_unit_id_fkey');
    expect(source).toContain('materialLabel(material)');
    expect(source).toContain("'لا يمكن استخدام خامة بدون وحدة قياس. حدد وحدة الخامة أولًا.'");
    expect(source).toContain("const recipeBranchId = unit.branch_id || branchFilter || ''");
  });

  it('keeps product creation free of product measurement units and links only manufactured inventory items', () => {
    const source = read('src/features/catalog/pages/ProductSetupWizardPage.tsx');

    expect(source).toContain(".eq('unit_type', 'manufactured')");
    expect(source).toContain("['2', isAr ? 'المصنعات' : 'Manufactured items']");
    expect(source).toContain('Products do not have measurement units.');
    expect(source).not.toContain("'وحدات المنتج'");
    expect(source).not.toContain("'Product units'");
  });

  it('shows each raw-material unit in product selection, quantity entry, and review', () => {
    const source = read('src/features/catalog/pages/ProductSetupWizardPage.tsx');

    expect(source).toContain('measurement_unit:measurement_units!raw_materials_unit_id_fkey');
    expect(source).toContain('rawMaterialLabel(material)');
    expect(source).toContain('rawUnitLabel(material)');
    expect(source).toContain("'لا يمكن استخدام خامة بدون وحدة قياس. افتح الخامة وحدد وحدتها أولًا.'");
  });
});
