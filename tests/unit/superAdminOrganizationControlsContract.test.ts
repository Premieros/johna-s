import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql=readFileSync(resolve(process.cwd(),
  'supabase/migrations/20261117112000_organization_profile_module_controls.sql'),'utf8');
const ui=readFileSync(resolve(process.cwd(),
  'src/features/admin/components/OrganizationControlsPanel.tsx'),'utf8');
const consolePage=readFileSync(resolve(process.cwd(),
  'src/features/admin/pages/SuperAdminConsolePage.tsx'),'utf8');

describe('organization-specific module control contract', () => {
  it('retains legacy default module access and only explicitly denies an organization module', () => {
    expect(sql).toContain('organization_feature_overrides');
    expect(sql).toContain('o.organization_id=p_tenant_id AND f.key=p_feature_key');
    expect(sql).toContain('o.enabled=false');
    expect(sql).toContain('ORGANIZATION_MODULE_DISABLED');
    expect(sql).toContain('EXECUTE replace(v_def,v_needle,v_guard)');
    expect(sql).not.toContain('UPDATE public.plan_features');
    expect(sql).not.toContain('UPDATE public.branch_feature_overrides');
    expect(sql).not.toContain('UPDATE public.settings');
  });
  it('writes only the selected organization through restricted audited RPCs', () => {
    for (const method of ['super_admin_set_organization_profile','super_admin_set_organization_module',
      'super_admin_reset_organization_module']) expect(sql).toContain(method);
    expect(sql).toContain('NOT public.is_platform_admin()');
    expect(sql).toContain('public.log_audit_action');
    expect(sql).toContain('SYSTEM_MODULE_LOCKED');
    expect(ui).toContain('organizationId');
    expect(ui).toContain('p_organization_id: organizationId');
    expect(consolePage).toContain('setSelectedOrganizationId(t.organization_id)');
  });
  it('does not mutate branch settings or give UI toggles fictional system-wide security claims', () => {
    expect(ui).toContain('full route and API coverage is subject to a separate audit');
    expect(consolePage).toContain('saveBranchSettings(targetBranchId, {');
    expect(sql).not.toContain('UPDATE public.branch_settings');
  });
});
