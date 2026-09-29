import { supabase } from '@/api';
import type { Product, RawMaterial, Supplier } from '@/lib/types';

export async function loadPurchaseRequestMeta(): Promise<{
  suppliers: Supplier[];
  products: Product[];
  rawMaterials: RawMaterial[];
}> {
  const [suppliersResult, productsResult, rawMaterialsResult] = await Promise.all([
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('products').select('*').eq('is_active', true).order('name'),
    supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
  ]);

  return {
    suppliers: (suppliersResult.data as Supplier[]) || [],
    products: (productsResult.data as Product[]) || [],
    rawMaterials: (rawMaterialsResult.data as RawMaterial[]) || [],
  };
}

export async function loadPurchaseRequestItems(requestId: string): Promise<Array<{
  name: string;
  quantity: number;
  estimated_cost: number | null;
}>> {
  const { data } = await supabase
    .from('purchase_request_items')
    .select('*, product:products(name), raw_material:raw_materials(name)')
    .eq('request_id', requestId);

  return (data || []).map((item: Record<string, unknown>) => ({
    name: (item.product as { name: string })?.name || (item.raw_material as { name: string })?.name || '-',
    quantity: Number(item.quantity),
    estimated_cost: item.estimated_cost != null ? Number(item.estimated_cost) : null,
  }));
}
