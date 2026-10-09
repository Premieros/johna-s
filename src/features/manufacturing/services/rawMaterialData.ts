import { loadRawMaterialDisplayPrices, type RawCurrentPriceRow } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import type { Branch, RawMaterialBatch, RawMaterialInventory, Unit } from '@/lib/types';

export async function loadRawMaterialMeta(): Promise<{
  inventory: RawMaterialInventory[];
  currentPrices: RawCurrentPriceRow[];
  batches: RawMaterialBatch[];
  units: Unit[];
  branches: Branch[];
}> {
  const [inventoryResult, batchesResult, unitsResult, branchesResult, currentPrices] = await Promise.all([
    supabase.from('raw_material_inventory').select('*, raw_material:raw_materials(*), branch:branches(*)').order('updated_at', { ascending: false }),
    supabase.from('raw_material_batches').select('*, raw_material:raw_materials(*), branch:branches(*)').order('created_at', { ascending: false }),
    supabase.from('measurement_units').select('*').eq('is_active', true).order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    loadRawMaterialDisplayPrices(null),
  ]);

  const error = inventoryResult.error || batchesResult.error || unitsResult.error || branchesResult.error;
  if (error) throw error;
  return {
    currentPrices,
    inventory: (inventoryResult.data as RawMaterialInventory[]) || [],
    batches: (batchesResult.data as RawMaterialBatch[]) || [],
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
