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

describe('POS unconditional sell-through contract', () => {
  it('does not run cart quantity availability guards before cart mutations', () => {
    expect(orderHook).not.toContain('useCartAwareAvailability');
    expect(orderHook).not.toContain('cartAvailability.canAdd');
    expect(orderHook).not.toContain('showPhysicalStockBlocked');
    expect(orderHook).not.toContain('showAvailabilityBlocked');
  });

  it('bypasses the legacy base-hook quantity guard for every visible product without changing server inventory behavior', () => {
    expect(orderHook).toContain('rawShortageOnly: Object.fromEntries(input.products.map((product) => [product.id, true]))');
    expect(orderHook).toContain('Physical raw-material deduction remains server-owned at send_to_kitchen');
  });

  it('keeps configuration and operational prerequisites blocking in the product browser', () => {
    expect(productBrowser).toContain('const availabilityError = availabilityErrors[product.id];');
    expect(productBrowser).toContain('if (availabilityError)');
    expect(productBrowser).toContain('const gated = !!availabilityError || !canAddToCart;');
    expect(productBrowser).toContain('const canAddToCart = canModifyOrder && hasBranch && shiftChecked && shiftOpen;');
  });

  it('does not expose stock quantity, out-of-stock, or raw-shortage badges on sale cards', () => {
    expect(productBrowser).not.toContain('رصيد خام ناقص');
    expect(productBrowser).not.toContain('نفد المخزون');
    expect(productBrowser).not.toContain("'Stock'");
    expect(productBrowser).not.toContain('stockKnown');
  });
});
