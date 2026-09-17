import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('print queue manual controls contract', () => {
  it('keeps retry and cancel permission-first, branch-scoped and audited', () => {
    const migration = read('supabase/migrations/20260917211000_print_queue_manual_controls.sql');

    expect(migration).toContain("'cancelled'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.retry_cloud_print_job');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.cancel_cloud_print_job');
    expect(migration).toContain("public.can_permission('settings.manage')");
    expect(migration).toContain('public.user_may_access_branch(v_job.branch_id)');
    expect(migration).toContain("'PRINT_JOB_MANUAL_RETRY'");
    expect(migration).toContain("'PRINT_JOB_CANCELLED'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.retry_cloud_print_job(uuid) FROM PUBLIC, anon');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.cancel_cloud_print_job(uuid) FROM PUBLIC, anon');
  });

  it('allows retry only for failures known safe from duplicate printing', () => {
    const migration = read('supabase/migrations/20260917211000_print_queue_manual_controls.sql');

    expect(migration).toContain("IF v_job.status <> 'failed'");
    for (const blocked of ['PRINT_OUTCOME_UNKNOWN', 'PRINT_CALLBACK_TIMEOUT', 'PRINT_SEQUENCE_CHANGED', 'INVALID_APPROVAL']) {
      expect(migration).toContain(blocked);
    }
    expect(migration).toContain("SET status = 'pending'");
    expect(migration).toContain('attempts = 0');
    expect(migration).toContain('next_attempt_at = now()');

    for (const forbidden of ['send_to_kitchen(', 'process_sale', 'deduct_sale_unit_inventory(', 'payment_transactions']) {
      expect(migration).not.toContain(forbidden);
    }
  });

  it('cancels only jobs that have not entered active print execution', () => {
    const migration = read('supabase/migrations/20260917211000_print_queue_manual_controls.sql');

    expect(migration).toContain("v_job.status NOT IN ('pending', 'failed')");
    expect(migration).toContain("SET status = 'cancelled'");
    expect(migration).toContain('cancelled_at = now()');
    expect(migration).toContain('cancelled_by = auth.uid()');
  });

  it('shows manager controls in the queue UI while keeping ambiguous failures blocked', () => {
    const monitor = read('src/features/pos/components/settings/PrintQueueMonitor.tsx');
    const service = read('src/features/pos/services/cloudPrintAdmin.ts');
    const cloud = read('src/features/pos/services/cloudPrint.ts');

    expect(monitor).toContain("can('settings.manage')");
    expect(monitor).toContain('retryCloudPrintJob');
    expect(monitor).toContain('cancelCloudPrintJob');
    expect(monitor).toContain('MANUAL_RETRY_BLOCKED_ERRORS');
    expect(monitor).toContain('PRINT_OUTCOME_UNKNOWN');
    expect(monitor).toContain('PRINT_CALLBACK_TIMEOUT');
    expect(monitor).toContain('PRINT_SEQUENCE_CHANGED');
    expect(monitor).toContain('INVALID_APPROVAL');
    expect(service).toContain("supabase.rpc('retry_cloud_print_job'");
    expect(service).toContain("supabase.rpc('cancel_cloud_print_job'");
    expect(cloud).toContain("'cancelled'");
  });
});
