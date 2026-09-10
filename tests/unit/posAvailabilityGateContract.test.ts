import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('POS availability gate contract', () => {
  it('uses authoritative stock availability instead of legacy product_components recipe presence', () => {
    const browser = read('src/features/pos/components/catalog/ProductBrowser.tsx');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(workspace).toContain("supabase.rpc('get_pos_product_availability'");
    expect(browser).not.toContain('const noRecipe =');
    expect(browser).not.toContain("t('noRecipe')");
    expect(browser).toContain('const ensureSellable = (product: Product) =>');
    expect(browser).toContain("if ((source[product.id] || 0) <= 0)");
    expect(browser).toContain('const blocked = unavailable || unknownAvailability || !canAddToCart;');
  });

  it('keeps raw-only products as a supported product composition', () => {
    const wizard = read('src/features/catalog/pages/ProductSetupWizardPage.tsx');

    expect(wizard).toContain("const derivedProductType: 'ready' | 'manufactured' = rawComponents.length > 0 || manufacturedComponents.length > 0 ? 'manufactured' : 'ready';");
    expect(wizard).toContain('if (rawComponents.length > 0)');
    expect(wizard).toContain("await supabase.from('recipes').insert");
    expect(wizard).toContain("await supabase.from('recipe_items').insert");
  });
});
