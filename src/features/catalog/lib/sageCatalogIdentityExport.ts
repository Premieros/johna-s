import type { Product } from '@/lib/types';

/**
 * Explicit, branch-scoped, read-only snapshot for the locally operated
 * Open Mercato catalog parity screen. This never imports or maps primary keys.
 * Intentionally excludes cost, price, stock, recipes, tax and customer data.
 */
export const SAGE_CATALOG_IDENTITY_EXPORT_VERSION = 'premieros.sage.catalog-identity.v1' as const;
export const SAGE_CATALOG_IDENTITY_EXPORT_LIMIT = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SageIdentityExportRow = Readonly<{
  id: string;
  name: string;
  sku: string | null;
  branch_id: string;
  product_type: 'ready' | 'manufactured';
  is_active: boolean;
}>;

export type SageCatalogIdentityExport = Readonly<{
  schemaVersion: typeof SAGE_CATALOG_IDENTITY_EXPORT_VERSION;
  sourceSystem: 'premieros-sage';
  branchId: string;
  readOnly: true;
  canImport: false;
  products: readonly SageIdentityExportRow[];
}>;

type IdentitySource = Pick<Product, 'id' | 'name' | 'sku' | 'branch_id' | 'product_type' | 'is_active'>;

export function buildSageCatalogIdentityExport(
  source: readonly IdentitySource[],
  selectedBranchId: string,
): SageCatalogIdentityExport {
  if (!UUID.test(selectedBranchId)) throw new Error('Choose a valid Sage branch before exporting');
  if (source.length > SAGE_CATALOG_IDENTITY_EXPORT_LIMIT) {
    throw new Error('Too many products for one identity export');
  }
  const productIds = new Set<string>();
  const products: SageIdentityExportRow[] = source.map((row) => {
    if (!UUID.test(row.id) || !UUID.test(row.branch_id) ||
        row.branch_id !== selectedBranchId ||
        typeof row.name !== 'string' || row.name.trim().length === 0 ||
        row.name.length > 500 ||
        (row.sku !== null && typeof row.sku !== 'string') ||
        (typeof row.sku === 'string' && row.sku.length > 200) ||
        (row.product_type !== 'ready' && row.product_type !== 'manufactured') ||
        typeof row.is_active !== 'boolean') {
      throw new Error('Invalid or foreign-branch Sage product; export was stopped');
    }
    if (productIds.has(row.id)) throw new Error('Duplicate Sage product ID; export was stopped');
    productIds.add(row.id);
    return {
      id: row.id,
      name: row.name,
      sku: row.sku?.trim() || null,
      branch_id: row.branch_id,
      product_type: row.product_type,
      is_active: row.is_active,
    };
  });
  // Deterministic identity ordering makes two snapshots easy to compare.
  products.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: SAGE_CATALOG_IDENTITY_EXPORT_VERSION,
    sourceSystem: 'premieros-sage',
    branchId: selectedBranchId,
    readOnly: true,
    canImport: false,
    products,
  };
}
