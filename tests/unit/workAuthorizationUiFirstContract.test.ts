import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const preview = readFileSync('src/features/admin/work-authorization/WorkAuthorizationPreview.tsx', 'utf8');
const contract = readFileSync('src/features/admin/work-authorization/workAuthorizationContract.ts', 'utf8');
const mock = readFileSync('src/features/admin/work-authorization/mockWorkAuthorizationProvider.ts', 'utf8');
const provider = readFileSync('src/features/admin/work-authorization/supabaseWorkAuthorizationProvider.ts', 'utf8');
const approvalCenter = readFileSync('src/features/admin/pages/ApprovalCenterPage.tsx', 'utf8');

describe('work authorization UI-first contract', () => {
  it('keeps preview authorization permission-first with no role-name guards', () => {
    expect(preview).not.toMatch(/branch_manager|ownerOnly|isAdminRole|user\?\.role|user\.role/);
    expect(approvalCenter).toContain("can('approvals.review')");
    expect(approvalCenter).toContain("can('approvals.policy.manage')");
    expect(approvalCenter).toContain('canManageSettings={canManagePolicies}');
  });

  it('keeps preview disconnected from Supabase work-authorization writes', () => {
    expect(preview).not.toMatch(/from ['"]@\/api['"]/);
    expect(preview).not.toContain('supabase.');
    expect(mock).not.toContain('supabase.');
    expect(contract).toContain('Components must not read/write work-authorization tables directly.');
  });

  it('defines a RPC-only production provider but keeps it unmounted during UI-first', () => {
    expect(provider).toContain("supabase.rpc(name, params)");
    expect(provider).not.toMatch(/\.from\(['"][^'"]+['"]\)/);
    expect(provider).toContain("'get_my_work_authorization_state'");
    expect(provider).toContain("'request_work_authorization'");
    expect(provider).toContain("'decide_work_authorization'");
    expect(provider).toContain("'revoke_work_authorization'");
    expect(provider).toContain("'set_work_authorization_requirement'");
    expect(approvalCenter).not.toContain('createSupabaseWorkAuthorizationClient');
    expect(preview).not.toContain('createSupabaseWorkAuthorizationClient');
  });

  it('mounts the staged preview without replacing the existing operational approval queue', () => {
    expect(approvalCenter).toContain('<WorkAuthorizationPreview');
    expect(approvalCenter).toContain("supabase.rpc('get_operational_approval_queue'");
    expect(approvalCenter).toContain("supabase.rpc('decide_operational_approval'");
  });

  it('keeps policy settings separately permission-gated', () => {
    expect(preview).toContain('{canManageSettings && (');
    expect(preview).toContain('<TabTrigger value="settings">');
    expect(preview).toContain('<TabContent value="settings">');
  });
});
