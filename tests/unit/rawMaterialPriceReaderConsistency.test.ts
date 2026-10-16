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
  'src/features/trade/pages/PurchasesPage.tsx',
  'src/features/trade/services/shiftClosingReport.ts',
];
describe('latest-approved material price reader contract', () => {
  it.each(consumers)('%s uses the unified price display reader', (path) => {
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('loadRawMaterialDisplayPrices');
    expect(content).not.toMatch(/\bloadRawCurrentPrices\b/);
  });
  it('costing uses latest-price rows and compact latest-price stock valuation', () => {
    const page = readFileSync('src/features/costing/pages/CostingCenterPage.tsx', 'utf8');
    const api = readFileSync('src/api/domains/costing.ts', 'utf8');
    expect(page).toContain('loadRawLatestPriceRows');
    expect(page).toContain('getRawMaterialCostOverview');
    expect(api).toContain("rpc('get_raw_material_latest_valuation', p)");
    expect(page).not.toMatch(/\b(loadRawCurrentPrices|loadRawFifoCosts)\b/);
  });
  it('sales reports use immutable kitchen cost snapshots rather than current price readers', () => {
    const content = readFileSync('src/features/reporting/services/stationSalesReport.ts', 'utf8');
    expect(content).not.toContain('loadRawMaterialDisplayPrices');
    expect(content).not.toContain('loadRawCurrentPrices');
    expect(content).toContain('component_snapshot');
  });
  it('does not replace an existing purchase material price with artificial zero', () => {
    const content = readFileSync('src/features/trade/pages/PurchasesPage.tsx', 'utf8');
    expect(content).toContain('default_cost: prices[raw.id] ?? raw.default_cost');
    expect(content).not.toContain('default_cost: prices[raw.id] ?? 0');
  });
});
