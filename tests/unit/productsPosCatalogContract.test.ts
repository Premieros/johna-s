import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const productsPage = readFileSync(resolve(root, 'src/features/catalog/pages/ProductsPage.tsx'), 'utf8');
const paginatedRows = readFileSync(resolve(root, 'src/hooks/usePaginatedRows.ts'), 'utf8');
const posWorkspace = readFileSync(resolve(root, 'src/features/pos/pages/PosWorkspacePage.tsx'), 'utf8');

describe('Products/POS catalog contract (P4)', () => {
  it('keeps Products search server-side across searchable product identifiers', () => {
    expect(productsPage).toContain("search: { term: search, columns: ['name', 'name_en', 'barcode', 'sku'] }");
    expect(productsPage).toContain('pageSize: 100');
    expect(productsPage).toContain('branch_id: branchFilter');

    // The shared pagination hook must apply the search to the Supabase query,
    // not filter only the rows already loaded into the browser.
    expect(paginatedRows).toContain("const filter = columns.map((column) => `${column}.ilike.*${term}*`).join(',')");
    expect(paginatedRows).toContain('bq = bq.or(filter)');
    expect(paginatedRows).toContain('return q.range(from, to)');
  });

  it('keeps POS catalog branch-scoped and active-only without a redundant category embed', () => {
    expect(posWorkspace).toContain("supabase.from('products').select('*').eq('branch_id', fixedBranch).eq('is_active', true)");
    expect(posWorkspace).toContain("supabase.from('products').select('*').eq('is_active', true).order('name')");
    expect(posWorkspace).not.toContain("category:categories(*)");
    expect(posWorkspace).toContain("supabase.from('categories').select('*')");
  });

  it('keeps the online POS catalog as the source saved for offline use', () => {
    expect(posWorkspace).toContain('loadedProds = (pRes.value.data as Product[]) || []');
    expect(posWorkspace).toContain('setProducts(loadedProds)');
    expect(posWorkspace).toContain('cachePosData');
  });

  it('invalidates POS catalog cache after catalog mutations', () => {
    expect(productsPage).toContain('invalidatePosCatalogCache');
  });
});
