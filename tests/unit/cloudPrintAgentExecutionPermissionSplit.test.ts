import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('cloud print agent execution permission split', () => {
  it('keeps polling enabled for authenticated branch users without settings.manage', () => {
    const source = readFileSync('src/features/pos/components/settings/CloudPrintAgent.tsx','utf8');
    expect(source).toContain('if (!user?.id) return;');
    expect(source).not.toContain("can('settings.manage')");
    expect(source).toContain('claimCloudPrintJobs(branchId, agentId, 12)');
  });

  it('keeps printer management UI protected by settings.manage', () => {
    const source = readFileSync('src/features/pos/components/settings/PrinterSettingsPanel.tsx','utf8');
    expect(source).toContain('settings.manage');
  });

  it('removes settings.manage only from execution RPCs while preserving auth, branch and claim guards', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918180500_cloud_print_agent_execution_without_settings_manage.sql',
      'utf8',
    );
    expect(migration).toContain('claim_cloud_print_jobs');
    expect(migration).toContain('start_cloud_print_job');
    expect(migration).toContain('complete_cloud_print_job');
    expect(migration).toContain("FROM PUBLIC,anon");
    expect(migration).toContain("TO authenticated");
  });
});
