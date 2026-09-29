import { supabase } from '@/api';

export async function saveAccount(params: {
  id?: string;
  branchId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const query = params.id
    ? supabase.from('chart_of_accounts').update(params.payload).eq('id', params.id)
    : supabase.from('chart_of_accounts').insert({ ...params.payload, branch_id: params.branchId });
  const { error } = await query;
  if (error) throw error;
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('chart_of_accounts').delete().eq('id', id);
  if (error) throw error;
}
