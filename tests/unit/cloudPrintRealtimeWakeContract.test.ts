import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/features/pos/components/settings/CloudPrintAgent.tsx',
  'utf8',
);

describe('web cloud print realtime wake contract', () => {
  it('removes the historical 700ms idle claim loop', () => {
    expect(source).not.toContain('POLL_INTERVAL_MS = 700');
    expect(source).not.toContain('setTimeout(() => void poll(), 700');
    expect(source).toContain('const REALTIME_RECONCILE_INTERVAL_MS = 60_000;');
    expect(source).toContain('const DISCONNECTED_POLL_INTERVAL_MS = 5_000;');
    expect(source).toContain('const BUSY_RETRY_INTERVAL_MS = 250;');
  });

  it('wakes from the existing branch-filtered durable print Realtime state', () => {
    expect(source).toContain(".channel(`cloud-print-wake-web-${branchId}-${agentId}`)");
    expect(source).toContain("table: 'cloud_print_wake_state'");
    expect(source).toContain('filter: `branch_id=eq.${branchId}`');
    expect(source).toContain("status === 'SUBSCRIBED'");
    expect(source).toContain('realtimeConnected = canUseRealtimeWake');
    expect(source).toContain('() => requestClaim(0)');
  });

  it('keeps a bounded disconnected fallback and an initial reconciliation drain', () => {
    expect(source).toContain('requestClaim(DISCONNECTED_POLL_INTERVAL_MS)');
    expect(source).toContain('// Drain any durable work that existed before the Realtime subscription joined.');
    expect(source).toContain('requestClaim(0);');
    expect(source).toContain('REALTIME_RECONCILE_INTERVAL_MS');
  });

  it('still verifies local printer transport before any durable claim', () => {
    const transportAt = source.indexOf('transportReady = await ensurePrintTransport();');
    const claimAt = source.indexOf('claimCloudPrintJobs(branchId, agentId, 12)');
    expect(transportAt).toBeGreaterThanOrEqual(0);
    expect(claimAt).toBeGreaterThan(transportAt);
  });

  it('drains real work immediately and coalesces wake events while busy', () => {
    expect(source).toContain('if (busy.current) {');
    expect(source).toContain('wakePending = true;');
    expect(source).toContain('scheduleClaim(BUSY_RETRY_INTERVAL_MS);');
    expect(source).toContain('if (jobs.length > 0) {');
    expect(source).toContain('await executeClaimedBatch(jobs, agentId);');
    expect(source).toContain('const delayMs = wakePending');
  });

  it('cleans up the realtime channel without changing durable queue RPC names', () => {
    expect(source).toContain('void supabase.removeChannel(channel)');
    expect(source).toContain('claimCloudPrintJobs(branchId, agentId, 12)');
    expect(source).toContain('startCloudPrintJob(job.id, agentId)');
    expect(source).toContain('completeCloudPrintJob(job.id, agentId');
  });
});
