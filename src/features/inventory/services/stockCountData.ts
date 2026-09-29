import { supabase } from '@/api';
import type { Branch, Product, RawMaterial, Warehouse } from '@/lib/types';

export async function loadStockCountMetadata(): Promise<{
  branches: Branch[];
  warehouses: Warehouse[];
  products: Product[];
  rawMaterials: RawMaterial[];
}> {
  const [branchesRes, warehousesRes, productsRes, rawMaterialsRes] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
    supabase.from('products').select('*').eq('is_active', true).order('name'),
    supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
  ]);

  return {
    branches: (branchesRes.data as Branch[] | null) || [],
    warehouses: (warehousesRes.data as Warehouse[] | null) || [],
    products: (productsRes.data as Product[] | null) || [],
    rawMaterials: (rawMaterialsRes.data as RawMaterial[] | null) || [],
  };
}
