import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/pos/components/settings/CloudPrintAgent.tsx', 'utf8');

describe('legacy print agent durable queue bridge', () => {
  it('does not require Electron before polling the durable print queue', () => {
    expect(source).not.toContain('if (!isRunningInElectron()');
    expect(source).toContain('getAvailablePrinters');
    expect(source).toContain('ensurePrintTransport');
    expect(source).toContain('claimCloudPrintJobs(branchId, agentId, 12)');
  });

  it('checks local print transport before claiming jobs', () => {
    const transportAt = source.indexOf('if (!(await ensurePrintTransport())) return;');
    const claimAt = source.indexOf('claimCloudPrintJobs(branchId, agentId, 12)');
    expect(transportAt).toBeGreaterThanOrEqual(0);
    expect(claimAt).toBeGreaterThan(transportAt);
  });
});
