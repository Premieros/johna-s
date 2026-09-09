import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/features/pos/components/catalog/ProductBrowser.tsx'), 'utf8');

describe('POS availability display contract', () => {
  it('distinguishes missing availability from a confirmed numeric zero', () => {
    expect(source).toContain('Object.prototype.hasOwnProperty.call(map, productId)');
    expect(source).toContain('const unknownAvailability = !stockKnown && !noRecipe;');
    expect(source).toContain("isAr ? 'تعذر التحقق' : 'Stock unknown'");
    expect(source).toContain("isAr ? 'نفد المخزون' : 'Out of stock'");
  });

  it('fails closed when availability is unknown instead of sending a fake zero to add-to-cart', () => {
    expect(source).toContain('if (!hasStockValue(source, product.id))');
    expect(source).toContain("isAr ? 'تعذر التحقق من المخزون. أعد المحاولة.' : 'Could not verify inventory. Please retry.'");
    expect(source).toContain('const blocked = unavailable || unknownAvailability || noRecipe || !canAddToCart;');
  });
});
