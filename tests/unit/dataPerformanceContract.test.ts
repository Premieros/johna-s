import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function src(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('data performance contracts', () => {
  it('keeps paginated list cache RAM-only and server-first exports authoritative', () => {
    const hook = src('src/hooks/usePaginatedRows.ts');
    expect(hook).toContain('sessionRowsCache = new Map');
    expect(hook).toContain('useLayoutEffect');
    expect(hook).toContain('fetchAll');
    expect(hook).toContain('NEVER reads from the');
    expect(hook).not.toMatch(/\b(?:window\.)?localStorage\s*\./);
    expect(hook).not.toMatch(/\bindexedDB\s*\./i);
  });

  it('does not preload all customers on initial sales page mount', () => {
    const sales = src('src/features/trade/pages/SalesPage.tsx');
    expect(sales).toContain('loadCustomersForBranch');
    expect(sales).toContain('void loadCustomersForBranch(sale.branch_id)');
    expect(sales).not.toContain('useEffect(() => { loadMeta(); }, [])');
  });

  it('defers product stock-component aggregation until edit intent', () => {
    const products = src('src/features/catalog/pages/ProductsPage.tsx');
    const loadMetaStart = products.indexOf('const loadMeta = useCallback');
    const loadMetaEnd = products.indexOf('useEffect(() => { loadMeta(); }', loadMetaStart);
    const loadMeta = products.slice(loadMetaStart, loadMetaEnd);
    expect(loadMeta).not.toContain('loadStockComponents');
    expect(products).toContain('const stockComponentsPromise = loadStockComponents()');
  });

  it('loads only metadata dimensions needed by the active report', () => {
    const reports = src('src/features/reporting/pages/ReportsPage.tsx');
    expect(reports).toContain('const dims = new Set(REPORT_FILTER_DIMS[reportType])');
    expect(reports).toContain("const needsSupplier = dims.has('supplier')");
    expect(reports).toContain("const needsProduct = dims.has('product')");
    expect(reports).toContain("const needsTable = dims.has('table')");
    expect(reports).toContain('[reportType, effectiveBranchFilter]');
  });

  it('keeps DataTable full export pluggable from an authoritative provider', () => {
    const table = src('src/components/DataTable.tsx');
    expect(table).toContain('exportDataProvider?: () => Promise<T[]> | T[]');
    expect(table).toContain('await exportDataProvider()');
  });
});
