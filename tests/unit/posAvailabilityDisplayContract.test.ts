import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/features/pos/components/catalog/ProductBrowser.tsx'), 'utf8');

describe('POS availability display contract', () => {
  it('does not expose quantity availability as a saleability signal', () => {
    expect(source).not.toContain('Object.prototype.hasOwnProperty.call(map, productId)');
    expect(source).not.toContain('const unknownAvailability = !stockKnown;');
    expect(source).not.toContain('const unavailable = stockKnown && stock <= 0;');
    expect(source).not.toContain("isAr ? 'نفد المخزون' : 'Out of stock'");
    expect(source).not.toContain("`${isAr ? 'متاح' : 'Stock'} ${stock}`");
  });

  it('allows sale regardless of stock quantity while keeping configuration errors blocking', () => {
    expect(source).toContain('const ensureSellable = (product: Product) =>');
    expect(source).toContain('const availabilityError = availabilityErrors[product.id];');
    expect(source).toContain('if (availabilityError)');
    expect(source).toContain('return true;');
    expect(source).not.toContain('if ((source[product.id] || 0) <= 0)');
    expect(source).not.toContain('if (!hasStockValue(source, product.id))');
    expect(source).toContain('const gated = !!availabilityError || !canAddToCart;');
  });

  it('does not gate the catalog on cart availability checking or cart availability errors', () => {
    expect(source).not.toContain('useCartAvailabilitySnapshot');
    expect(source).not.toContain('cartChecking');
    expect(source).not.toContain('cartError');
    expect(source).not.toContain('productCartChecking');
    expect(source).not.toContain('productCartAvailabilityError');
  });

  it('does not require a legacy product_components recipe when configuration is otherwise valid', () => {
    expect(source).not.toContain('const noRecipe =');
    expect(source).not.toContain("t('noRecipe')");
  });
});
