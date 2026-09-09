import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const productBrowser = readFileSync(resolve(root, 'src/features/pos/components/catalog/ProductBrowser.tsx'), 'utf8');

describe('POS exact scan contract', () => {
  it('accepts exact barcode or SKU on Enter', () => {
    expect(productBrowser).toContain("item.barcode === search || item.sku === search");
  });

  it('keeps barcode/SKU visible in the search guidance', () => {
    expect(productBrowser).toContain('barcode / SKU');
  });
});
