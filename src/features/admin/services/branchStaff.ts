import { supabase } from '@/api';

export type BranchStaffOption = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export async function fetchBranchStaff(branchId: string): Promise<BranchStaffOption[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, is_active')
    .eq('branch_id', branchId)
    .order('full_name');

  if (error) throw error;
  return (data as BranchStaffOption[] | null) || [];
}
