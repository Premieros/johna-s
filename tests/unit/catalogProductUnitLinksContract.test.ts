import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const productsPage = read('src/features/catalog/pages/ProductsPage.tsx');
const catalogApi = read('src/api/domains/catalog.ts');

describe('catalog product unit links contract (PR3 6B)', () => {
  it('routes product_unit_links mutations through the catalog API wrapper', () => {
    expect(productsPage).toContain('await api.catalog.setProductUnitLinks(pid, desiredLinks)');
    expect(productsPage).not.toMatch(/from\('product_unit_links'\)\.delete\(/);
    expect(productsPage).not.toMatch(/from\('product_unit_links'\)\.update\(/);
    expect(productsPage).not.toMatch(/from\('product_unit_links'\)\.insert\(/);
  });

  it('keeps product_unit_links reads in the page read-only', () => {
    expect(productsPage).toContain("from('product_unit_links').select('unit_id,quantity,unit:inventory_units(id,name,unit_type,cost_price)')");
  });

  it('preserves the proven diff update semantics inside setProductUnitLinks', () => {
    expect(catalogApi).toContain(".from('product_unit_links')\n      .select('unit_id')");
    expect(catalogApi).toContain('const removedIds = [...existingIds].filter((unitId) => !desiredIds.has(unitId));');
    expect(catalogApi).toContain(".delete().eq('product_id', product_id).in('unit_id', removedIds)");
    expect(catalogApi).toContain('.update({ quantity: row.quantity })');
    expect(catalogApi).toContain(".insert({ product_id, unit_id: row.unit_id, quantity: row.quantity })");
  });

  it('does not revert the wrapper to destructive delete-all then insert-all behavior', () => {
    expect(catalogApi).not.toContain("const { error: delErr } = await supabase.from('product_unit_links').delete().eq('product_id', product_id);");
  });

  it('keeps legacy product_units isolated behind replaceProductUnits', () => {
    expect(productsPage).toContain('api.catalog.replaceProductUnits');
    expect(catalogApi).toContain("rpc('replace_product_units', p)");
  });
});
