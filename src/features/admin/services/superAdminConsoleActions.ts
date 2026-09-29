import { supabase } from '@/api';

export async function setOrganizationActive(orgId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('organizations').update({ is_active: isActive }).eq('id', orgId);
  if (error) throw error;
}

export async function updateSuperAdminUser(params: {
  userId: string;
  fullName: string;
  role: string;
  isActive: boolean;
  branchId: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      full_name: params.fullName,
      role: params.role,
      is_active: params.isActive,
      branch_id: params.branchId,
    })
    .eq('id', params.userId);
  if (error) throw error;
}
