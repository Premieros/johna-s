import { loadRawMaterialDisplayPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import type { Product, RawMaterial, Supplier, Warehouse } from '@/lib/types';

export type PurchaseRawUnit = {
  id: string;
  name: string;
  symbol?: string | null;
};

export type PurchaseMeta = {
  suppliers: Supplier[];
  products: Product[];
  rawMaterials: RawMaterial[];
  warehouses: Warehouse[];
  rawUnits: PurchaseRawUnit[];
};

export async function fetchPurchaseMeta(branchId?: string | null): Promise<PurchaseMeta> {
  let supplierQuery = supabase.from('suppliers').select('*').order('name');
  let productQuery = supabase.from('products').select('*').eq('is_active', true).order('name');
  let rawMaterialQuery = supabase.from('raw_materials').select('*, unit:units(*)').eq('is_active', true).order('name');
  let warehouseQuery = supabase.from('warehouses').select('*').order('name');

  if (branchId) {
    supplierQuery = supplierQuery.eq('branch_id', branchId);
    productQuery = productQuery.eq('branch_id', branchId);
    rawMaterialQuery = rawMaterialQuery.eq('branch_id', branchId);
    warehouseQuery = warehouseQuery.eq('branch_id', branchId);
  }

  const [suppliersRes, productsRes, rawMaterialsRes, warehousesRes, unitsRes, prices] = await Promise.all([
    supplierQuery,
    productQuery,
    rawMaterialQuery,
    warehouseQuery,
    supabase.from('measurement_units').select('id,name,symbol').eq('is_active', true).order('name'),
    loadRawMaterialDisplayPrices(branchId || null),
  ]);

  const error = suppliersRes.error || productsRes.error || rawMaterialsRes.error || warehousesRes.error || unitsRes.error;
  if (error) throw error;
  const costs = rawCurrentPriceMap(prices);
  return {
    suppliers: (suppliersRes.data as Supplier[]) || [],
    products: (productsRes.data as Product[]) || [],
    rawMaterials: ((rawMaterialsRes.data as RawMaterial[]) || []).map(raw => ({ ...raw, default_cost: costs[raw.id] ?? 0 })),
    warehouses: (warehousesRes.data as Warehouse[]) || [],
    rawUnits: (unitsRes.data as PurchaseRawUnit[]) || [],
  };
}

export async function fetchEditablePurchaseItems(purchaseId: string) {
  return supabase
    .from('purchase_items')
    .select('product_id,raw_material_id,unit_name,quantity,unit_cost')
    .eq('purchase_id', purchaseId)
    .order('created_at');
}

export type PurchaseRawMaterialPayload = {
  code: string;
  name: string;
  unit_id: string;
  category: null;
  min_stock: number;
  default_cost: number;
  description: null;
  branch_id: string;
  is_active: boolean;
};

export async function createPurchaseRawMaterial(payload: PurchaseRawMaterialPayload) {
  return supabase.from('raw_materials').insert(payload).select('*').single();
}

export async function fetchPurchaseViewItems(purchaseId: string) {
  return supabase
    .from('purchase_items')
    .select('*, product:products(name), raw_material:raw_materials(name)')
    .eq('purchase_id', purchaseId);
}
