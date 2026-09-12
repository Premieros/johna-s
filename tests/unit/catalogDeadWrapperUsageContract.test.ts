import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const catalogApiPath = resolve(repoRoot, 'src/api/domains/catalog.ts');

const deadWrapperCandidates = [
  'getInventoryUnit',
  'createInventoryUnit',
  'updateInventoryUnit',
  'deleteInventoryUnit',
  'getProductUnitLinks',
  'getInventoryUnitRecipes',
  'setInventoryUnitRecipes',
  'listMeasurementUnits',
  'listWasteCategories',
  'listWasteEntries',
  'getWasteReport',
  'getProductionVariance',
  'listInventoryUnitProductions',
  'getKitchenQueue',
  'routeToStation',
] as const;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(fullPath);
  }
  return files;
}

const sourceFiles = collectSourceFiles(resolve(repoRoot, 'src'));

describe('catalog dead wrapper usage contract (PR3 6C)', () => {
  it('proves each 6C removal candidate has zero callers outside its catalog API definition', () => {
    for (const wrapper of deadWrapperCandidates) {
      const callers = sourceFiles
        .filter((file) => file !== catalogApiPath)
        .filter((file) => readFileSync(file, 'utf8').includes(wrapper))
        .map((file) => file.slice(repoRoot.length + 1).replace(/\\/g, '/'));

      expect(callers, `${wrapper} unexpectedly gained a source caller`).toEqual([]);
    }
  });

  it('does not classify the live 6B setProductUnitLinks wrapper as dead', () => {
    const productsPage = readFileSync(resolve(repoRoot, 'src/features/catalog/pages/ProductsPage.tsx'), 'utf8');
    expect(productsPage).toContain('api.catalog.setProductUnitLinks');
    expect(deadWrapperCandidates).not.toContain('setProductUnitLinks');
  });
});
