import { supabase } from '@/api';
import type { Product, PurchaseRequestRow, RawMaterial, Supplier } from '@/lib/types';

export async function loadRfqMeta(): Promise<{
  suppliers: Supplier[];
  products: Product[];
  rawMaterials: RawMaterial[];
  requests: PurchaseRequestRow[];
}> {
  const [suppliersResult, productsResult, rawMaterialsResult, requestsResult] = await Promise.all([
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('products').select('*').eq('is_active', true).order('name'),
    supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
    supabase.from('purchase_requests').select('*').eq('status', 'approved').order('request_number', { ascending: false }),
  ]);

  return {
    suppliers: (suppliersResult.data as Supplier[]) || [],
    products: (productsResult.data as Product[]) || [],
    rawMaterials: (rawMaterialsResult.data as RawMaterial[]) || [],
    requests: (requestsResult.data as PurchaseRequestRow[]) || [],
  };
}
