import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const consumers = [
  'src/features/catalog/services/pricingData.ts',
  'src/features/inventory/services/lowStockData.ts',
  'src/features/trade/services/purchasePageData.ts',
  'src/features/catalog/services/productSetupData.ts',
  'src/features/costing/services/recipeEstimateData.ts',
  'src/features/manufacturing/services/rawMaterialData.ts',
  'src/features/manufacturing/services/recipeData.ts',
  'src/features/import-export/validation-context-service.ts',
  'src/features/import-export/export-service.ts',
  'src/features/reporting/services/stationSalesReport.ts',
  'src/features/trade/pages/PurchasesPage.tsx',
  'src/features/costing/pages/CostingCenterPage.tsx',
  'src/features/trade/services/shiftClosingReport.ts',
];
describe('FIFO-first material price reader contract', () => {
  it.each(consumers)('%s uses the unified price display reader', (path) => {
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('loadRawMaterialDisplayPrices');
    expect(content).not.toMatch(/\bloadRawCurrentPrices\b/);
  });
  it('does not replace an existing purchase material price with artificial zero', () => {
    const content = readFileSync('src/features/trade/pages/PurchasesPage.tsx', 'utf8');
    expect(content).toContain('default_cost: prices[raw.id] ?? raw.default_cost');
    expect(content).not.toContain('default_cost: prices[raw.id] ?? 0');
  });
});
