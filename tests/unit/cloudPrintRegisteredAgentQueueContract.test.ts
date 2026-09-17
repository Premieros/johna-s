import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  expect(startAt).toBeGreaterThanOrEqual(0);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe('registered print agent and visible station queue contract', () => {
  const migration = read('supabase/migrations/20260917205000_cloud_print_agent_registration_and_queue.sql');

  it('keeps device registration admin-only while runtime execution is bound to a registered branch device', () => {
    const register = between(migration, 'CREATE OR REPLACE FUNCTION public.register_cloud_print_agent', 'CREATE OR REPLACE FUNCTION public.heartbeat_cloud_print_agent');
    const heartbeat = between(migration, 'CREATE OR REPLACE FUNCTION public.heartbeat_cloud_print_agent', 'CREATE OR REPLACE FUNCTION public.get_cloud_print_queue');
    const claim = between(migration, 'CREATE OR REPLACE FUNCTION public.claim_cloud_print_jobs', 'CREATE OR REPLACE FUNCTION public.start_cloud_print_job');
    const start = between(migration, 'CREATE OR REPLACE FUNCTION public.start_cloud_print_job', 'CREATE OR REPLACE FUNCTION public.complete_cloud_print_job');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.cloud_print_agents');
    expect(register).toContain("public.can_permission('settings.manage')");
    expect(heartbeat).not.toContain("public.can_permission('settings.manage')");
    expect(heartbeat).toContain('public.user_may_access_branch(v_agent.branch_id)');
    expect(claim).not.toContain("public.can_permission('settings.manage')");
    expect(claim).toContain('FROM public.cloud_print_agents a');
    expect(claim).toContain('a.agent_id = p_agent_id');
    expect(claim).toContain('a.branch_id = p_branch_id');
    expect(start).not.toContain("public.can_permission('settings.manage')");
    expect(start).toContain('a.branch_id = v_job.branch_id');
  });

  it('keeps queue visibility settings-manage and branch scoped', () => {
    const queue = between(migration, 'CREATE OR REPLACE FUNCTION public.get_cloud_print_queue', 'CREATE OR REPLACE FUNCTION public.claim_cloud_print_jobs');
    expect(queue).toContain("public.can_permission('settings.manage')");
    expect(queue).toContain('public.user_may_access_branch(p_branch_id)');
    expect(queue).toContain("j.status IN ('pending', 'claimed', 'printing', 'failed', 'submitted')");
    expect(queue).toContain("a.last_seen_at > now() - interval '20 seconds'");
  });

  it('lets the installed Electron agent heartbeat and poll after one-time registration', () => {
    const agent = read('src/features/pos/components/settings/CloudPrintAgent.tsx');
    expect(agent).toContain('heartbeatCloudPrintAgent');
    expect(agent).toContain('registerCloudPrintAgent');
    expect(agent).toContain("const mayRegister = can('settings.manage')");
    expect(agent).not.toContain("if (!isRunningInElectron() || !user?.id || !can('settings.manage')) return;");
    expect(agent).toContain('const jobs = await claimCloudPrintJobs(branchId, agentId, 12)');
  });

  it('shows a settings-only station grouped queue monitor', () => {
    const monitor = read('src/features/pos/components/settings/PrintQueueMonitor.tsx');
    const launcher = read('src/features/pos/components/settings/PrinterSettingsLauncher.tsx');
    expect(monitor).toContain("can('settings.manage')");
    expect(monitor).toContain('getCloudPrintQueue(branchId, 120)');
    expect(monitor).toContain('Print Station Queue');
    expect(monitor).toContain('job.station_code');
    expect(launcher).toContain('<PrintQueueMonitor />');
    expect(launcher).toContain('<PrinterSettingsPanel />');
  });
});
