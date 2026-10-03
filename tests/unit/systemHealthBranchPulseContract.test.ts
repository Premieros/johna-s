import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261003150000_system_health_branch_pulse.sql', 'utf8');
const panel = readFileSync('src/features/admin/components/BranchPulsePanel.tsx', 'utf8');
const telemetry = readFileSync('src/lib/userIssueTelemetry.ts', 'utf8');
const toast = readFileSync('src/components/Toast.tsx', 'utf8');
const boundary = readFileSync('src/components/ErrorBoundary.tsx', 'utf8');

describe('System Health Branch Pulse contract', () => {
  it('uses bounded admin RPCs instead of direct table reads from the panel', () => {
    expect(panel).toContain('admin.getBranchActivitySnapshot');
    expect(panel).toContain('admin.getUserIssueSummary');
    expect(panel).not.toContain('supabase.from(');
    expect(panel).not.toContain('supabase.rpc(');
  });

  it('keeps zero activity neutral instead of classifying a quiet branch as unhealthy', () => {
    expect(migration).toContain("THEN 'quiet'");
    expect(panel).toContain('No activity recorded in the selected period.');
    expect(panel).toContain('لا يوجد نشاط مسجل في الفترة المحددة.');
  });

  it('uses cross-signal warnings only', () => {
    for (const code of [
      'PRINT_FAILURES',
      'STALE_OPEN_ORDERS',
      'SALES_WITHOUT_SHIFT_COVERAGE',
      'SALES_WITHOUT_PRINT_SUBMISSION',
    ]) {
      expect(migration).toContain(code);
      expect(panel).toContain(code);
    }
  });

  it('preserves printing truth by separating submission from physical confirmation', () => {
    expect(migration).toContain("cpj.status = 'submitted'");
    expect(migration).toContain("cpj.status = 'printed'");
    expect(panel).toContain('Accepted / failed');
    expect(panel).not.toContain('Print success');
  });

  it('stores user issues in a private table with no direct authenticated access', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS private.user_issue_events');
    expect(migration).toContain('ALTER TABLE private.user_issue_events ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE private.user_issue_events FROM PUBLIC, anon, authenticated');
    expect(migration).not.toContain('CREATE POLICY');
  });

  it('bounds capture fields and rejects common secret-bearing text', () => {
    expect(migration).toContain('RATE_LIMITED');
    expect(migration).toContain('SENSITIVE_CONTENT_REJECTED');
    expect(migration).toContain("left(regexp_replace(btrim(coalesce(p_user_message, '')), '[[:cntrl:]]', ' ', 'g'), 360)");
    expect(migration).not.toContain('jsonb p_details');
    expect(migration).not.toContain('p_stack');
  });

  it('captures centralized user-visible and render errors without blocking workflows', () => {
    expect(toast).toContain("void reportUserIssue(message, { action: 'toast_error' })");
    expect(boundary).toContain('void reportUserIssue(error');
    expect(telemetry).toContain('Telemetry must never block');
    expect(telemetry).toContain('redactTelemetryMessage');
    expect(telemetry).not.toContain('console.error');
  });

  it('keeps System Health read paths permission-first and branch-scoped', () => {
    expect(migration).toContain("public.can_permission('settings.manage')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_branch_activity_snapshot');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_user_issue_summary');
  });

  it('does not mutate operational business tables', () => {
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\./i);
    expect(migration).not.toMatch(/UPDATE\s+public\./i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });
});
