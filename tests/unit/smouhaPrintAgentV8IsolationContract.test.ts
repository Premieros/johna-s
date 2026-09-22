import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Smouha Print Agent V8 isolation and query budget', () => {
  it('is a separate app identity and starts with Production queue disabled', () => {
    const build = read('print-agent-v8/BuildConfig.cs');
    const config = read('print-agent-v8/AgentConfig.cs');
    expect(build).toContain('PremierSmouhaFormPrintAgentV08');
    expect(build).not.toContain('PremierSmouhaPrintAgentV07');
    expect(config).toContain('QueueEnabled { get; set; } = false');
  });

  it('removes the 700ms idle claim loop and uses event wake plus slow fallback', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const realtime = read('print-agent-v8/RealtimeWakeClient.cs');
    expect(worker).not.toContain('Task.Delay(700');
    expect(worker).toContain('ReconcileSeconds');
    expect(worker).toContain('DisconnectedPollSeconds');
    expect(worker).toContain('RealtimeWakeCount');
    expect(realtime).toContain('cloud_print_wake_state');
    expect(realtime).toContain('postgres_changes');
  });

  it('prints the structured template as a fixed form before text fallback', () => {
    const worker = read('print-agent-v8/CloudPrintWorker.cs');
    const renderer = read('print-agent-v8/FixedTemplateRenderer.cs');
    expect(worker).toContain('FixedTemplateRenderer.TryGetTemplate');
    expect(worker).toContain('PrintTemplateAsync');
    expect(worker).toContain('PrintTextAsync');
    expect(renderer).toContain('qty-badge');
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
