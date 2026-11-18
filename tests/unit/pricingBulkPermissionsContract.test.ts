import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/features/catalog/pages/PricingPage.tsx', 'utf8');

describe('pricing spreadsheet permission contract', () => {
  it('requires product import capability and product edit for bulk product price changes', () => {
    expect(page).toContain("const allowedToImport = allowedToEdit && (tab !== 'products' || can('products.import'))");
    expect(page).toContain("if (!file || !branchId || !allowedToImport) return");
    expect(page).toContain("preview.tab !== tab || !allowedToImport || busy) return");
    expect(page).toContain('{allowedToImport && <Button');
  });

  it('requires explicit products.export before exporting prices', () => {
    expect(page).toContain("const allowedToExport = tab !== 'products' || can('products.export')");
    expect(page).toContain("if (!branchId || busy || !allowedToExport) return");
    expect(page).toContain('{allowedToExport && <Button');
  });

  it('retains raw material editing and branch-scoped pricing writes', () => {
    expect(page).toContain("tab === 'products' ? canProductsEdit : canRawEdit");
    expect(page).toContain("costing.setRawMaterialPrice({");
    expect(page).toContain("p_branch_id: branchId");
    expect(page).toContain("updateManufacturedPricing({");
    expect(page).toContain("updateProductPricing({");
  });
});
