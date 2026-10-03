import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const superAdmin = readFileSync('src/features/admin/pages/SuperAdminConsolePage.tsx', 'utf8');
const pulse = readFileSync('src/features/admin/components/BranchPulsePanel.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');

describe('Super Admin Branch Pulse integration', () => {
  it('renders Branch Pulse directly inside the Super Admin diagnostics tab', () => {
    expect(superAdmin).toContain("activeTab === 'health'");
    expect(superAdmin).toContain('<BranchPulsePanel allBranches />');
    expect(superAdmin).toContain('الفحص الذاتي للنظام');
  });

  it('requests all permitted branches only when explicitly enabled', () => {
    expect(pulse).toContain('allBranches?: boolean');
    expect(pulse).toContain('const branchFilter = allBranches ? null : activeBranchFilter');
    expect(pulse).toContain('p_branch_id: branchFilter || null');
  });

  it('does not weaken the existing standalone System Health permission boundary', () => {
    expect(routes).toContain('path={APP_ROUTES.systemHealth}');
    expect(routes).toContain('permission="settings.manage"');
    expect(routes).toContain('<SystemHealthPage />');
  });

  it('keeps the diagnostics tab free of direct database access', () => {
    expect(superAdmin).not.toContain("supabase.from(");
    expect(superAdmin).not.toContain("supabase.rpc(");
  });
});
