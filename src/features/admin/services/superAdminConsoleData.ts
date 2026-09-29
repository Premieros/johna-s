import { admin, supabase } from '@/api';

export interface SuperAdminTenantStats {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  is_active: boolean;
  created_at: string;
  branch_count: number;
  user_count: number;
  total_branches: number;
  active_branches: number;
}

export interface SuperAdminTenantUser {
  user_id: string;
  email: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
  branch_id: string | null;
  branch_name: string | null;
  org_id: string | null;
  org_name: string | null;
  created_at: string;
}

export interface SuperAdminAuditLogRow {
  id: string;
  action: string;
  entity: string;
  user_email: string | null;
  created_at: string;
  details: unknown;
}

export async function fetchUserCreationControl(): Promise<{
  allowed: boolean | null;
  audit: SuperAdminAuditLogRow[];
}> {
  let allowed: boolean | null = null;

  const { data } = await admin.canCreateNewUser();
  if (data && typeof data.allowed === 'boolean') {
    allowed = data.allowed;
  } else {
    const { data: settingsData } = await supabase
      .from('system_settings')
      .select('config')
      .eq('id', 1)
      .maybeSingle();

    const config = settingsData?.config as
      | { security?: { allow_new_user_creation?: boolean } }
      | null
      | undefined;

    if (typeof config?.security?.allow_new_user_creation === 'boolean') {
      allowed = config.security.allow_new_user_creation;
    }
  }

  const { data: auditData } = await supabase
    .from('audit_log')
    .select('id, action, entity, user_email, created_at, details')
    .eq('action', 'TOGGLE_ALLOW_NEW_USER_CREATION')
    .order('created_at', { ascending: false })
    .limit(20);

  return {
    allowed,
    audit: (auditData as SuperAdminAuditLogRow[] | null) || [],
  };
}

export async function fetchTenantStats(): Promise<SuperAdminTenantStats[]> {
  const [orgsRes, brRes, memRes] = await Promise.all([
    supabase.from('organizations').select('id, name, slug, is_active, created_at').order('created_at', { ascending: false }),
    supabase.from('branches').select('id, is_active, organization_id'),
    supabase.from('organization_members').select('organization_id, user_id, is_active'),
  ]);

  const orgs = orgsRes.data || [];
  const branches = brRes.data || [];
  const members = memRes.data || [];

  return orgs.map((organization) => {
    const orgBranches = branches.filter((branch) => branch.organization_id === organization.id);
    const orgMembers = members.filter((member) => member.organization_id === organization.id && member.is_active);

    return {
      organization_id: organization.id,
      organization_name: organization.name,
      organization_slug: organization.slug,
      is_active: organization.is_active ?? true,
      created_at: organization.created_at,
      branch_count: orgBranches.length,
      user_count: orgMembers.length,
      total_branches: orgBranches.length,
      active_branches: orgBranches.filter((branch) => branch.is_active).length,
    };
  });
}

export async function fetchUsersAndAudit(): Promise<{
  users: SuperAdminTenantUser[];
  audit: SuperAdminAuditLogRow[];
}> {
  const [usersRes, auditRes, branchesRes, organizationsRes, membersRes] = await Promise.all([
    supabase.from('users').select('id, email, username, full_name, role, is_active, branch_id, created_at').order('created_at', { ascending: false }),
    supabase.from('audit_log').select('id, action, entity, user_email, created_at, details').order('created_at', { ascending: false }).limit(100),
    supabase.from('branches').select('id, name, organization_id'),
    supabase.from('organizations').select('id, name'),
    supabase.from('organization_members').select('user_id, organization_id').eq('is_active', true),
  ]);

  const branchMap = new Map((branchesRes.data || []).map((branch) => [branch.id, branch]));
  const orgMap = new Map((organizationsRes.data || []).map((organization) => [organization.id, organization]));
  const memberMap = new Map((membersRes.data || []).map((member) => [member.user_id, member.organization_id]));

  const users: SuperAdminTenantUser[] = (usersRes.data || []).map((user) => {
    const branch = user.branch_id ? branchMap.get(user.branch_id) : undefined;
    const orgId = memberMap.get(user.id) || branch?.organization_id || null;
    const organization = orgId ? orgMap.get(orgId) : undefined;

    return {
      user_id: user.id,
      email: user.email || '',
      username: user.username || '',
      full_name: user.full_name || '',
      role: user.role || 'cashier',
      is_active: user.is_active ?? true,
      branch_id: user.branch_id || null,
      branch_name: branch?.name || null,
      org_id: orgId,
      org_name: organization?.name || null,
      created_at: user.created_at || new Date().toISOString(),
    };
  });

  return {
    users,
    audit: (auditRes.data as SuperAdminAuditLogRow[] | null) || [],
  };
}


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

export async function fetchSuperAdminHealthSnapshot(): Promise<Record<string, { ok: boolean; message: string }>> {
  const checks: Record<string, { ok: boolean; message: string }> = {};

  try {
    const dbCheck = await supabase.from('users').select('id', { count: 'exact', head: true });
    checks.database = {
      ok: !dbCheck.error,
      message: dbCheck.error ? dbCheck.error.message : 'Database connection healthy',
    };
  } catch (error) {
    checks.database = { ok: false, message: String(error) };
  }

  try {
    const authUser = (await supabase.auth.getUser()).data.user;
    checks.auth = {
      ok: !!authUser,
      message: authUser ? `Authenticated as: ${authUser.email}` : 'No active session',
    };
  } catch (error) {
    checks.auth = { ok: false, message: String(error) };
  }

  try {
    const sysRes = await supabase.from('system_settings').select('id').limit(1);
    checks.system_settings = {
      ok: !sysRes.error,
      message: sysRes.error ? sysRes.error.message : 'System settings accessible',
    };
  } catch (error) {
    checks.system_settings = { ok: false, message: String(error) };
  }

  return checks;
}
