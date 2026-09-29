import { supabase } from '@/api';

export async function saveSupplier(params: { id?: string; payload: Record<string, unknown> }): Promise<string | null> {
  if (params.id) {
    const { error } = await supabase.from('suppliers').update(params.payload).eq('id', params.id);
    if (error) throw error;
    return params.id;
  }

  const { data, error } = await supabase.from('suppliers').insert(params.payload).select('id').single();
  if (error) throw error;
  return data?.id || null;
}

export async function deleteSupplier(id: string): Promise<void> {
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) throw error;
}
