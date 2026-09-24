import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const preview = readFileSync('src/features/admin/work-authorization/WorkAuthorizationPreview.tsx', 'utf8');
const contract = readFileSync('src/features/admin/work-authorization/workAuthorizationContract.ts', 'utf8');
const mock = readFileSync('src/features/admin/work-authorization/mockWorkAuthorizationProvider.ts', 'utf8');
const provider = readFileSync('src/features/admin/work-authorization/supabaseWorkAuthorizationProvider.ts', 'utf8');
const approvalCenter = readFileSync('src/features/admin/pages/ApprovalCenterPage.tsx', 'utf8');
const gate = readFileSync('src/features/admin/work-authorization/WorkAuthorizationGate.tsx', 'utf8');
const boundary = readFileSync('src/features/admin/work-authorization/WorkAuthorizationAppBoundary.tsx', 'utf8');
const app = readFileSync('src/app/App.tsx', 'utf8');

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

  it('uses a RPC-only production provider behind the work-authorization feature flag', () => {
    expect(provider).toContain("supabase.rpc(name, params)");
    expect(provider).not.toMatch(/\.from\(['\"][^'\"]+['\"]\)/);
    expect(provider).toContain("'get_my_work_authorization_state'");
    expect(provider).toContain("'request_work_authorization'");
    expect(provider).toContain("'decide_work_authorization'");
    expect(provider).toContain("'revoke_work_authorization'");
    expect(provider).toContain("'set_work_authorization_requirement'");
    expect(provider).toContain(".channel('work-authorization-' + userId + '-' + branchId)");
    expect(approvalCenter).toContain('createSupabaseWorkAuthorizationClient');
    expect(approvalCenter).toContain("VITE_WORK_AUTHORIZATION_GATE === '1'");
    expect(boundary).toContain("VITE_WORK_AUTHORIZATION_GATE === '1'");
    expect(preview).not.toContain('supabase.');
  });

  it('mounts the staged preview without replacing the existing operational approval queue', () => {
    expect(approvalCenter).toContain('<WorkAuthorizationPreview');
    expect(approvalCenter).toContain("supabase.rpc('get_operational_approval_queue'");
    expect(approvalCenter).toContain("supabase.rpc('decide_operational_approval'");
  });

  it('keeps the employee gate centralized and free of polling or role-name checks', () => {
    expect(gate).toContain('data-testid="work-authorization-gate"');
    expect(gate).toContain('client.getMyState(branchId)');
    expect(gate).toContain('client.requestAuthorization(branchId)');
    expect(gate).not.toMatch(/setInterval|setTimeout|poll|branch_manager|ownerOnly|user\\?\\.role|user\\.role/);
    expect(gate).not.toContain('supabase.');
  });

  it('mounts one app-level boundary while keeping the print agent outside it', () => {
    expect(app).toContain('<WorkAuthorizationAppBoundary>');
    expect(app).toContain('<AppRoutes />');
    expect(app).toContain('<RouteScopedExtras />');
    expect(boundary).toContain("location.pathname === APP_ROUTES.approvals");
    expect(boundary).toContain("can('work.authorization.approve')");
  });

  it('keeps policy settings separately permission-gated', () => {
    expect(preview).toContain('{canManageSettings && (');
    expect(preview).toContain('<TabTrigger value="settings">');
    expect(preview).toContain('<TabContent value="settings">');
  });
});
