import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('POS catalog runtime contract', () => {
  it('keeps the sale catalog independent from stock/recipe preflight queries', () => {
    const browser = read('src/features/pos/components/catalog/ProductBrowser.tsx');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(workspace).not.toContain("supabase.rpc('get_pos_product_sellability'");
    expect(workspace).not.toContain("supabase.rpc('get_pos_product_availability'");
    expect(workspace).not.toContain("from('product_components')");
    expect(workspace).toContain('Kitchen send is the');
    expect(workspace).toContain('authoritative inventory deduction point');
    expect(browser).not.toContain('availabilityErrors');
    expect(browser).not.toContain('ensureSellable');
    expect(browser).toContain('const gated = !canAddToCart;');
  });

  it('keeps operational permission/shift prerequisites while inventory quantity stays non-blocking', () => {
    const browser = read('src/features/pos/components/catalog/ProductBrowser.tsx');

    expect(browser).toContain('const canAddToCart = canModifyOrder && hasBranch && shiftChecked && shiftOpen;');
    expect(browser).not.toContain('stockKnown');
    expect(browser).not.toContain('Out of stock');
    expect(browser).not.toContain('نفد المخزون');
  });
});
