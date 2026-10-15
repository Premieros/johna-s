import type { Product } from '@/lib/types';
import { supabase } from '@/api';
import {
  buildSageCatalogIdentityExport,
  SAGE_CATALOG_IDENTITY_EXPORT_LIMIT,
  type SageCatalogIdentityExport,
} from '../lib/sageCatalogIdentityExport';

type SourceProduct = Pick<Product, 'id' | 'name' | 'sku' | 'branch_id' | 'product_type' | 'is_active'>;

/** The only Supabase count read for this export lives in a feature service. */
export async function countSageProductsInBranch(branchId: string): Promise<number | null> {
  const { count, error } = await supabase.from('products')
    .select('id', { count: 'exact', head: true }).eq('branch_id', branchId);
  if (error) throw error;
  return count;
}


/**
 * A read-only two-pass export: count (via authenticated Supabase RLS), then
 * fetch all rows using Sage's existing pagination, and reconcile. Any
 * branch/session/search change or short read cancels the entire export.
 */
export async function loadSageIdentitySnapshot(options: {
  branchId: string;
  hasUnchangedScope: () => boolean;
  countBranchProducts: (branchId: string) => Promise<number | null>;
  fetchAllProducts: () => Promise<readonly SourceProduct[]>;
}): Promise<SageCatalogIdentityExport> {
  const { branchId, hasUnchangedScope, countBranchProducts, fetchAllProducts } = options;
  const verifyScope = () => {
    if (!hasUnchangedScope()) throw new Error('Export scope changed; cancelled without downloading');
  };
  verifyScope();
  const count = await countBranchProducts(branchId);
  verifyScope();
  if (!Number.isSafeInteger(count) || count === null || count < 0) {
    throw new Error('Unable to verify the full Sage product count');
  }
  if (count > SAGE_CATALOG_IDENTITY_EXPORT_LIMIT) throw new Error('Identity export row limit exceeded');
  const items = await fetchAllProducts();
  verifyScope();
  if (items.length !== count) {
    throw new Error('Export is incomplete or changed during reading; no file will be downloaded');
  }
  const result = buildSageCatalogIdentityExport(items, branchId);
  verifyScope();
  return result;
}
