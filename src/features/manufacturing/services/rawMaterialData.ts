import { loadRawMaterialDisplayPrices, type RawCurrentPriceRow } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import { fetchAllReportRows } from '@/features/reporting/fetchAllReportRows';
import type { Branch, RawMaterialBatch, RawMaterialInventory, Unit } from '@/lib/types';

export async function loadRawMaterialMeta(branchId: string | null = null, tab: 'materials' | 'stock' | 'batches' = 'materials'): Promise<{
  inventory: RawMaterialInventory[];
  currentPrices: RawCurrentPriceRow[];
  batches: RawMaterialBatch[];
  units: Unit[];
  branches: Branch[];
}> {
  let inventoryQuery = supabase.from('raw_material_inventory').select('*, raw_material:raw_materials(*), branch:branches(*)').order('updated_at', { ascending: false }).order('id');
  let batchQuery = supabase.from('raw_material_batches').select('*, raw_material:raw_materials(*), branch:branches(*)').order('created_at', { ascending: false }).order('id');
  if (branchId) {
    inventoryQuery = inventoryQuery.eq('branch_id', branchId);
    batchQuery = batchQuery.eq('branch_id', branchId);
  }
  const [inventory, batches, unitsResult, branchesResult, currentPrices] = await Promise.all([
    tab === 'stock' ? fetchAllReportRows(inventoryQuery) : Promise.resolve([]),
    tab === 'batches' ? fetchAllReportRows(batchQuery) : Promise.resolve([]),
    supabase.from('measurement_units').select('*').eq('is_active', true).order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    tab !== 'batches' ? loadRawMaterialDisplayPrices(branchId) : Promise.resolve([]),
  ]);

  const error = unitsResult.error || branchesResult.error;
  if (error) throw error;
  return {
    currentPrices,
    inventory: (inventory as RawMaterialInventory[]) || [],
    batches: (batches as RawMaterialBatch[]) || [],
    units: (unitsResult.data as Unit[]) || [],
    branches: (branchesResult.data as Branch[]) || [],
  };
}

export async function updateRawMaterial(id: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('raw_materials').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteRawMaterial(id: string): Promise<void> {
  const { error } = await supabase.from('raw_materials').delete().eq('id', id);
  if (error) throw error;
}
