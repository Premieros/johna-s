import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const browser = readFileSync(
  'src/features/pos/components/catalog/ProductBrowser.tsx',
  'utf8',
);
const workspace = readFileSync(
  'src/features/pos/pages/PosWorkspacePage.tsx',
  'utf8',
);

describe('POS product browser render performance contract', () => {
  it('memoizes the full product browser boundary', () => {
    expect(browser).toContain('export const ProductBrowser = memo(function ProductBrowser');
    expect(browser).toContain("import { memo, useMemo, useState } from 'react';");
  });

  it('keeps the configure-product prop stable across cart/order rerenders', () => {
    expect(workspace).toContain('const handleConfigureProduct = useCallback((product: Product) => {');
    expect(workspace).toContain('onConfigureProduct={handleConfigureProduct}');
    expect(workspace).not.toContain('onConfigureProduct={(p) => setConfigProduct(p)}');
  });

  it('evaluates edit permission once per browser render', () => {
    expect(browser).toContain("const canEditProducts = can('products.edit');");
    expect(browser.match(/can\('products\.edit'\)/g)?.length).toBe(1);
  });

  it('normalizes search once without changing the product filter contract', () => {
    expect(browser).toContain('const normalizedSearch = useMemo(() => search.toLocaleLowerCase(), [search]);');
    expect(browser).toContain('filteredProducts.map((product) => {');
    expect(browser).not.toContain('filteredProducts.slice(');
  });

  it('lets the browser skip offscreen product-card layout and paint', () => {
    expect(browser).toContain("contentVisibility: 'auto'");
    expect(browser).toContain("containIntrinsicSize: '210px'");
  });

  it('preserves product identity and add/configure behavior', () => {
    expect(browser).toContain('data-testid=');
    expect(browser).toContain('pos-product-card-');
    expect(browser).toContain('onAddToCart(product)');
    expect(browser).toContain('onConfigureProduct(product)');
    expect(browser).toContain('addProductDirectly(product)');
  });
});
