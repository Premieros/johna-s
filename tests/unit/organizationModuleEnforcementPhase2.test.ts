import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { permissionFeatureKey, ENFORCED_ORGANIZATION_MODULE_KEYS } from '../../src/lib/permissionFeatureKey';

const sql = readFileSync(resolve(process.cwd(),
  'supabase/migrations/20261117113000_organization_module_report_costing_enforcement.sql'), 'utf8');
const panel = readFileSync(resolve(process.cwd(),
  'src/features/admin/components/OrganizationControlsPanel.tsx'), 'utf8');

describe('organization module phase 2 security contracts', () => {
  it('separates advanced reports and costing from basic reports', () => {
    expect(permissionFeatureKey('reports.costing')).toBe('costing');
    expect(permissionFeatureKey('reports.financial')).toBe('advanced_reports');
    expect(permissionFeatureKey('reports.view')).toBe('reports');
    expect(ENFORCED_ORGANIZATION_MODULE_KEYS.has('costing')).toBe(true);
    expect(ENFORCED_ORGANIZATION_MODULE_KEYS.has('advanced_reports')).toBe(true);
    expect(sql).toContain("WHEN p_permission='reports.costing' THEN 'costing'");
    expect(sql).toContain("WHEN p_permission='reports.financial' THEN 'advanced_reports'");
    expect(sql).toContain("'branch_management','employees','costing','advanced_reports'");
  });

  it('preserves all existing module defaults and guarded Super Admin writes', () => {
    expect(sql).toContain('MODULE_ENFORCEMENT_NOT_READY');
    expect(sql).toContain('NOT public.is_platform_admin()');
    expect(sql).toContain('SYSTEM_MODULE_LOCKED');
    expect(sql).not.toContain('UPDATE public.organization_feature_overrides');
    expect(sql).not.toContain('UPDATE public.organizations');
    expect(sql).not.toContain('UPDATE public.settings');
    expect(sql).not.toContain('UPDATE public.branch_settings');
  });

  it('keeps unsupported controls disabled and explains why for each module', () => {
    for (const key of ['ai_assistant','api_access','multi_branch','units',
      'excel_import','excel_export','customer_display']) {
      expect(ENFORCED_ORGANIZATION_MODULE_KEYS.has(key)).toBe(false);
      expect(panel).toContain(key + ':');
    }
    expect(panel).toContain('disabled={!supported || !!busyFeature || !!error}');
  });
});
