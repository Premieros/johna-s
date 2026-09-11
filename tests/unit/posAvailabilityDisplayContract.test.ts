import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/features/pos/components/catalog/ProductBrowser.tsx'), 'utf8');

describe('POS availability display contract', () => {
  it('distinguishes missing availability from a confirmed numeric zero', () => {
    expect(source).toContain('Object.prototype.hasOwnProperty.call(map, productId)');
    expect(source).toContain('const unknownAvailability = !stockKnown;');
    expect(source).toContain('const unavailable = stockKnown && stock <= 0;');
    expect(source).toContain("isAr ? 'تعذر التحقق' : 'Stock unknown'");
    expect(source).toContain("isAr ? 'نفد المخزون' : 'Out of stock'");
  });

  it('fails closed when availability is unknown or zero instead of bypassing stock validation', () => {
    expect(source).toContain('const ensureSellable = (product: Product) =>');
    expect(source).toContain('if (!hasStockValue(source, product.id))');
    expect(source).toContain("isAr ? 'تعذر التحقق من المخزون. أعد المحاولة.' : 'Could not verify inventory. Please retry.'");
    expect(source).toContain('if ((source[product.id] || 0) <= 0)');
    expect(source).toContain("isAr ? 'المنتج غير متوفر بالمخزون.' : 'Product is out of stock.'");
    expect(source).toContain('const blocked = unavailable || unknownAvailability || !canAddToCart;');
  });

  it('trusts the authoritative raw-shortage signal regardless of the broad product type label', () => {
    expect(source).toContain('const isRawShortageOnly = (product: Product) => rawShortageOnly[product.id] === true;');
    expect(source).not.toContain("product.product_type !== 'manufactured' && rawShortageOnly[product.id] === true");
    expect(source).toContain('const gated = (!rawShortage && blocked) || cartChecking || cartAvailabilityError;');
  });

  it('does not require a legacy product_components recipe when authoritative availability is known', () => {
    expect(source).not.toContain('const noRecipe =');
    expect(source).not.toContain("t('noRecipe')");
  });
});
