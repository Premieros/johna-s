import { supabase } from '@/api';

export async function saveCustomer(params: { id?: string; payload: Record<string, unknown> | Record<string, unknown>[] }): Promise<void> {
  const query = params.id
    ? supabase.from('customers').update(params.payload as Record<string, unknown>).eq('id', params.id)
    : supabase.from('customers').insert(params.payload);
  const { error } = await query;
  if (error) throw error;
}

export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}
