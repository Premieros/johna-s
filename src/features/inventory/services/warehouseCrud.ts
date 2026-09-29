import { supabase } from '@/api';

export async function saveWarehouse(params: { id?: string; payload: Record<string, unknown> }): Promise<void> {
  const query = params.id
    ? supabase.from('warehouses').update(params.payload).eq('id', params.id)
    : supabase.from('warehouses').insert(params.payload);
  const { error } = await query;
  if (error) throw error;
}

export async function deleteWarehouse(id: string): Promise<void> {
  const { error } = await supabase.from('warehouses').delete().eq('id', id);
  if (error) throw error;
}
