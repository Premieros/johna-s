import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Smouha Print Agent V8.1 Lite isolation and query budget', () => {
  it('is a separate app identity and starts with Production queue disabled', () => {
    const build = read('print-agent-v8/BuildConfig.cs');
    const config = read('print-agent-v8/AgentConfig.cs');
    expect(build).toContain('PremierSmouhaFormPrintAgentV08');
    expect(build).not.toContain('PremierSmouhaPrintAgentV07');
    expect(config).toContain('QueueEnabled { get; set; } = false');
  });

  it('builds as framework-dependent Lite instead of bundling the runtime', () => {
    const project = read('print-agent-v8/PremierSmouhaFormPrintAgentV08.csproj');
    const workflow = read('.github/workflows/smouha-print-agent-v8-build.yml');
    expect(project).toContain('<SelfContained>false</SelfContained>');
    expect(project).toContain('<Version>8.1.0</Version>');
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

  it('removes the 700ms idle claim loop and uses event wake plus slow fallback', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const realtime = read('print-agent-v8/RealtimeWakeClient.cs');
    expect(worker).not.toContain('Task.Delay(700');
    expect(worker).toContain('ReconcileSeconds');
    expect(worker).toContain('DisconnectedPollSeconds');
    expect(worker).toContain('RealtimeWakeCount');
    expect(realtime).toContain('BuildConfig.WakeTable');\n    expect(read('print-agent-v8/BuildConfig.cs')).toContain('cloud_print_wake_state');
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

  it('does not alter frozen V7 RPC definitions in the optional wake SQL', () => {
    const sql = read('print-agent-v8/sql/OPTIONAL_cloud_print_v8_realtime_wake.sql');
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(claim_cloud_print_jobs|start_cloud_print_job|complete_cloud_print_job)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.cloud_print_jobs/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.cloud_print_jobs/i);
    expect(sql).toContain('AFTER INSERT ON public.cloud_print_jobs');
  });

  it('journals physical submission before remote completion to prevent duplicates', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const mark = worker.indexOf('PrintJournal.Mark(job.Id)');
    const complete = worker.indexOf('await _api.CompleteAsync', mark);
    expect(mark).toBeGreaterThan(0);
    expect(complete).toBeGreaterThan(mark);
  });
});
