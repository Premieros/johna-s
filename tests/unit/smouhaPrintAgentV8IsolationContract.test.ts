import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Cleopatra Print Agent V8.1.1 Lite isolation and query budget', () => {
  it('is a separate app identity and starts with Production queue disabled', () => {
    const build = read('print-agent-v8/BuildConfig.cs');
    const config = read('print-agent-v8/AgentConfig.cs');
    expect(build).toContain('PremierCleopatraFormPrintAgentV0811');
    expect(build).not.toContain('PremierSmouhaPrintAgentV07');
    expect(config).toContain('QueueEnabled { get; set; } = false');
  });

  it('builds as framework-dependent Lite instead of bundling the runtime', () => {
    const project = read('print-agent-v8/PremierSmouhaFormPrintAgentV08.csproj');
    const workflow = read('.github/workflows/smouha-print-agent-v8-build.yml');
    expect(project).toContain('<SelfContained>false</SelfContained>');
    expect(project).toContain('<Version>8.1.1</Version>');
    expect(workflow).toContain('--self-contained false');
    expect(workflow).toContain('Windows Desktop Runtime 8 x64');
  });

  it('does not expose a manual legacy text test button', () => {
    const setup = read('print-agent-v8/SetupForm.cs');
    expect(setup).not.toContain('اختبار Text fallback');
    expect(setup).not.toContain('testLegacy');
  });

  it('keeps Arabic totals label-right and value-left', () => {
    const renderer = read('print-agent-v8/FixedTemplateRenderer.cs');
    expect(renderer).toContain('Arabic form: label stays on the RIGHT, numeric value on the LEFT.');
    expect(renderer).toContain('innerWidth * 0.40f');
    expect(renderer).toContain('innerWidth * 0.42f');
  });

  it('verifies the realtime postgres subscription handshake before reporting connected', () => {
    const realtime = read('print-agent-v8/RealtimeWakeClient.cs');

    expect(realtime).toContain('join_ref = reference');
    expect(realtime).toContain('string.Equals(reference, _joinRef');
    expect(realtime).toContain('HasPostgresSubscriptionConfirmation(payload)');
    expect(realtime).toContain('response.TryGetProperty("postgres_changes"');
    expect(realtime).toContain('changes.GetArrayLength() > 0');
    expect(realtime).toContain('eventName == "postgres_changes"');
    expect(realtime).not.toContain('json.Contains(BuildConfig.WakeTable');
  });

  it('accepts Supabase system readiness for postgres_changes and exposes real join errors', () => {
    const realtime = read('print-agent-v8/RealtimeWakeClient.cs');

    expect(realtime).toContain('replication_ready = true');
    expect(realtime).toContain('presence = new { enabled = false');
    expect(realtime).toContain('eventName == "system"');
    expect(realtime).toContain('extension, "postgres_changes"');
    expect(realtime).toContain('Realtime متصل — PostgreSQL subscription جاهز');
    expect(realtime).toContain('ReadNestedReason(payload)');
    expect(realtime).toContain('eventName == "phx_error"');
    expect(realtime).toContain('eventName == "phx_close"');
    // Keep the user JWT out of the websocket HTTP handshake. Supabase Realtime
    // authenticates the channel with access_token after the upgrade.
    expect(realtime).toContain('access_token = _accessToken');
    expect(realtime).not.toContain('SetRequestHeader("Authorization"');
  });

  it('removes the 700ms idle claim loop and uses event wake plus slow fallback', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const realtime = read('print-agent-v8/RealtimeWakeClient.cs');
    expect(worker).not.toContain('Task.Delay(700');
    expect(worker).toContain('ReconcileSeconds');
    expect(worker).toContain('DisconnectedPollSeconds');
    expect(worker).toContain('RealtimeWakeCount');
    expect(realtime).toContain('BuildConfig.WakeTable');
    expect(read('print-agent-v8/BuildConfig.cs')).toContain('cloud_print_wake_state');
    expect(realtime).toContain('postgres_changes');
  });

  it('prints the structured template as a fixed form before text fallback', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const renderer = read('print-agent-v8/FixedTemplateRenderer.cs');
    expect(worker).toContain('FixedTemplateRenderer.TryGetTemplate');
    expect(worker).toContain('PrintTemplateAsync');
    expect(worker).toContain('PrintTextAsync');
    expect(renderer).toContain('badgeW');
    expect(renderer).toContain('itemsHeading');
    expect(renderer).toContain('totals');
  });

  it('scopes the agent identity strictly to Cleopatra while Production wake enablement remains separate', () => {
    const build = read('print-agent-v8/BuildConfig.cs');
    const cleopatra = '279e6662-e901-40b2-9170-7dda0b471ba7';

    expect(build).toContain(`BranchId = "${cleopatra}"`);
    expect(build).toContain('PremierCleopatraFormPrintAgentV0811');
    expect(build).not.toContain('19c3fd23-d784-455b-8840-f4f2ac619651');
  });

  it('does not alter frozen V7 RPC definitions in the optional wake SQL', () => {
    const sql = read('print-agent-v8/sql/OPTIONAL_cloud_print_v8_realtime_wake.sql');
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(claim_cloud_print_jobs|start_cloud_print_job|complete_cloud_print_job)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.cloud_print_jobs/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.cloud_print_jobs/i);
    expect(sql).toContain('AFTER INSERT ON public.cloud_print_jobs');
  });

  it('extends realtime wake only to Smouha and Cleopatra without changing frozen print RPCs', () => {
    const sql = read('supabase/migrations/20260925163000_cloud_print_v8_cleopatra_realtime_wake.sql');
    const smouha = '19c3fd23-d784-455b-8840-f4f2ac619651';
    const cleopatra = '279e6662-e901-40b2-9170-7dda0b471ba7';

    expect(sql).toContain(smouha);
    expect(sql).toContain(cleopatra);
    expect(sql).toContain('branch_id IN (');
    expect(sql).toContain('NEW.branch_id NOT IN (');
    expect(sql).toContain('WHEN (');
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(claim_cloud_print_jobs|start_cloud_print_job|complete_cloud_print_job)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.cloud_print_jobs/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.cloud_print_jobs/i);
  });

  it('journals physical submission before remote completion to prevent duplicates', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const mark = worker.indexOf('PrintJournal.Mark(job.Id)');
    const complete = worker.indexOf('await _api.CompleteAsync', mark);
    expect(mark).toBeGreaterThan(0);
    expect(complete).toBeGreaterThan(mark);
  });
});
