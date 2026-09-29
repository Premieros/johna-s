import { supabase } from '@/api';

export async function saveCategory(params: { id?: string; payload: Record<string, unknown> }): Promise<void> {
  const query = params.id
    ? supabase.from('categories').update(params.payload).eq('id', params.id)
    : supabase.from('categories').insert(params.payload);
  const { error } = await query;
  if (error) throw error;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}
