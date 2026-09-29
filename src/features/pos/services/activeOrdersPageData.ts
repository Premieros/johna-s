import { supabase } from '@/api';
import type { DiningArea } from '@/lib/types';

export interface ActiveOrderProductOption {
  id: string;
  name: string;
  name_en: string | null;
}

export async function loadDiningAreas(branchId: string): Promise<DiningArea[]> {
  const { data, error } = await supabase
    .from('dining_areas')
    .select('*')
    .eq('branch_id', branchId)
    .order('sort_order');
  if (error) throw error;
  return (data as DiningArea[]) || [];
}

export async function loadActiveOrderProducts(branchId: string): Promise<ActiveOrderProductOption[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, name_en')
    .eq('is_active', true)
    .eq('branch_id', branchId);
  if (error) throw error;
  return (data as ActiveOrderProductOption[]) || [];
}

export async function createDiningArea(params: { branchId: string; name: string }): Promise<void> {
  const { error } = await supabase
    .from('dining_areas')
    .insert({ name: params.name, branch_id: params.branchId });
  if (error) throw error;
}

export async function deleteDiningArea(areaId: string): Promise<void> {
  const { error } = await supabase.from('dining_areas').delete().eq('id', areaId);
  if (error) throw error;
}

export async function deleteDiningTable(tableId: string): Promise<void> {
  const { error } = await supabase.from('dining_tables').delete().eq('id', tableId);
  if (error) throw error;
}
