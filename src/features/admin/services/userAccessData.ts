import { supabase } from '@/api';

type BranchAccessResult = {
  success?: boolean;
  error?: string;
  detail?: string;
};

export async function loadUserBranchAccess(userId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_user_branch_access', { p_user_id: userId });
  if (error) throw error;
  return ((data as { branch_id: string }[]) ?? []).map((row) => row.branch_id);
}

export async function saveUserBranchAccess(userId: string, branchIds: string[]): Promise<BranchAccessResult> {
  const { data, error } = await supabase.rpc('set_user_branch_access', {
    p_user_id: userId,
    p_branch_ids: branchIds,
  });
  if (error) throw error;
  return (data || {}) as BranchAccessResult;
}

export async function updateUserProfile(userId: string, payload: {
  full_name: string;
  username: string;
  role: string;
  branch_id: string;
  is_active: boolean;
}): Promise<void> {
  const { error } = await supabase.from('users').update(payload).eq('id', userId);
  if (error) throw error;
}
