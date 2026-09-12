import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const orderHook = readFileSync(
  resolve(process.cwd(), 'src/features/pos/hooks/usePosOrder.ts'),
  'utf8',
);
const productBrowser = readFileSync(
  resolve(process.cwd(), 'src/features/pos/components/catalog/ProductBrowser.tsx'),
  'utf8',
);

describe('POS raw-shortage UI guard contract', () => {
  it('does not let cart verifier state block raw-shortage-only quantity mutations', () => {
    expect(orderHook).toContain('if (!isRawShortageOnly(product.id) && !cartAvailability.canAdd(product.id, quantity))');
    expect(orderHook).toContain('if (delta > 0 && !isRawShortageOnly(target.product.id) && !cartAvailability.canAdd(target.product.id, delta))');
    expect(orderHook).toContain('if (positiveDemand > 0 && !isRawShortageOnly(nextItem.product.id) && !cartAvailability.canAdd(nextItem.product.id, positiveDemand))');
  });

  it('keeps configuration errors blocking while raw shortage bypasses cart checking/error state', () => {
    const configGuard = productBrowser.indexOf('const availabilityError = availabilityErrors[product.id];');
    const rawBypass = productBrowser.indexOf('if (isRawShortageOnly(product))');
    const cartChecking = productBrowser.indexOf('if (cartChecking)');
    const cartError = productBrowser.indexOf('if (cartError)');

    expect(configGuard).toBeGreaterThan(-1);
    expect(rawBypass).toBeGreaterThan(configGuard);
    expect(cartChecking).toBeGreaterThan(rawBypass);
    expect(cartError).toBeGreaterThan(rawBypass);
  });

  it('keeps strict products fail-closed on cart verification failures', () => {
    expect(productBrowser).toContain('const productCartChecking = cartChecking && !rawShortage;');
    expect(productBrowser).toContain('const productCartAvailabilityError = cartAvailabilityError && !rawShortage;');
    expect(productBrowser).toContain("? (!!availabilityError || !canAddToCart)");
    expect(productBrowser).toContain(': blocked || productCartChecking || productCartAvailabilityError;');
  });
});
