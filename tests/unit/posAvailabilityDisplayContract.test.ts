import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/features/pos/components/catalog/ProductBrowser.tsx'), 'utf8');

describe('POS availability display contract', () => {
  it('does not expose quantity availability as a saleability signal', () => {
    expect(source).not.toContain('const unavailable =');
    expect(source).not.toContain("isAr ? 'نفد المخزون' : 'Out of stock'");
    expect(source).not.toContain("'Stock'");
    expect(source).not.toContain('stockKnown');
  });

  it('does not use recipe/configuration preflight to gate product selection', () => {
    expect(source).not.toContain('ensureSellable');
    expect(source).not.toContain('availabilityErrors');
    expect(source).toContain('const gated = !canAddToCart;');
    expect(source).toContain('if (!canAddToCart) return;');
  });

  it('does not gate the catalog on cart availability checking or cart availability errors', () => {
    expect(source).not.toContain('useCartAvailabilitySnapshot');
    expect(source).not.toContain('cartChecking');
    expect(source).not.toContain('cartError');
    expect(source).not.toContain('productCartChecking');
    expect(source).not.toContain('productCartAvailabilityError');
  });

  it('does not require a legacy product_components recipe in the browser', () => {
    expect(source).not.toContain('ProductComponent');
    expect(source).not.toContain('recipeMap');
    expect(source).not.toContain('const noRecipe =');
  });
});
