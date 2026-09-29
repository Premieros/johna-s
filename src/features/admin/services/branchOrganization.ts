import { supabase } from '@/api';

export async function fetchBranchOrganizationId(branchId: string): Promise<string | null> {
  const { data } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', branchId)
    .maybeSingle();

  return (data as { organization_id: string | null } | null)?.organization_id ?? null;
}
