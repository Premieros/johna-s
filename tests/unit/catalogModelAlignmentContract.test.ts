import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('catalog model alignment contract', () => {
  it('keeps recipe/manufacturing URLs as compatibility redirects only', () => {
    const routes = read('src/app/routes.tsx');
    expect(routes).not.toContain('const RecipesPage = lazy');
    expect(routes).toContain('path={APP_ROUTES.recipes} element={<Navigate to={APP_ROUTES.products} replace />}');
    expect(routes).toContain('path={APP_ROUTES.manufacturingCenter} element={<Navigate to={APP_ROUTES.inventoryUnits} replace />}');
    expect(routes).toContain('path={APP_ROUTES.production} element={<Navigate to={APP_ROUTES.inventoryUnits} replace />}');
    expect(routes).toContain('path={APP_ROUTES.productionUnits} element={<Navigate to={APP_ROUTES.inventoryUnits} replace />}');
  });

  it('does not expose Recipes as a live catalog menu destination', () => {
    const menu = read('src/core/navigation/menu.config.ts');
    expect(menu).not.toContain("id: 'recipes'");
    expect(menu).toContain("catalog: { ar: 'الكتالوج والمكونات', en: 'Catalog & Components' }");
  });

  it('retires production import and presents direct product raws instead of recipes', () => {
    const configs = read('src/features/import-export/entity-configs.ts');
    const center = read('src/features/import-export/pages/ImportExportCenterPage.tsx');
    expect(configs).not.toContain('  production: {');
    expect(configs).toContain("titleAr: 'الخامات المباشرة للمنتجات'");
    expect(configs).toContain("titleEn: 'Direct Product Raw Materials'");
    expect(configs).not.toContain("requiredPermission: 'manufacturing.view'");
    expect(center).not.toContain("window.location.hash = '/recipes'");
    expect(center).toContain("selectedEntity === 'recipes') window.location.hash = '/products'");
  });
  it('centralizes direct raw composition behind catalog API', () => {
    const catalog = read('src/api/domains/catalog.ts');
    const wizard = read('src/features/catalog/pages/ProductSetupWizardPage.tsx');
    const products = read('src/features/catalog/pages/ProductsPage.tsx');

    expect(catalog).toContain('getProductDirectRawComponents');
    expect(catalog).toContain('saveProductDirectRawComponents');
    expect(wizard).toContain('api.catalog.saveProductDirectRawComponents');
    expect(wizard).not.toContain("supabase.from('recipes').insert");
    expect(wizard).not.toContain("supabase.from('recipe_items').insert");
    expect(products).toContain('api.catalog.getProductDirectRawComponents');
    expect(products).toContain('api.catalog.saveProductDirectRawComponents');
    expect(products).toContain("can('recipes.manage')");
  });
});
