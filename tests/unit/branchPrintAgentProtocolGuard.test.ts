import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #487: the per-branch print-agent protocol is a non-negotiable compatibility
// boundary. These static contracts complement, not replace, agent/hardware E2E.
const service = readFileSync('src/features/pos/services/cloudPrint.ts', 'utf8');

describe('branch print-agent protocol compatibility', () => {
  it('preserves the same claim/start/complete backend RPCs', () => {
    expect(service).toContain("supabase.rpc('claim_cloud_print_jobs'");
    expect(service).toContain("supabase.rpc('start_cloud_print_job'");
    expect(service).toContain("supabase.rpc('complete_cloud_print_job'");
    expect(service).toContain('p_branch_id: branchId');
    expect(service).toContain('p_agent_id: agentId');
    expect(service).toContain('p_job_id: jobId');
  });

  it('continues to enqueue kitchen jobs through its dedicated RPC', () => {
    expect(service).toContain("enqueue_cloud_kitchen_print");
    expect(service).toContain('KITCHEN_ENQUEUE_MAX_ATTEMPTS');
  });

  it('coalesces only monitor/list reads, with no completed-result caching', () => {
    expect(service).toContain("from('cloud_print_jobs')");
    expect(service).toContain(".eq('branch_id', scopedBranchId)");
    expect(service).toContain('activeQueueReads.delete(key)');
    expect(service).toContain('activeQueueReads.clear()');
  });
});
