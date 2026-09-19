import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from '../../src/lib/permissionDefs';

const migration = readFileSync(
  'supabase/migrations/20260919161500_require_reprint_approval_for_non_approvers.sql',
  'utf8',
);

describe('receipt reprint approval guard', () => {
  it('keeps first-print permission for cashier but not direct reprint bypass', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.cashier).toContain('pos.receipt.print');
    expect(DEFAULT_ROLE_PERMISSIONS.cashier).not.toContain('pos.reprint');
  });

  it('preserves direct reprint for approval-capable management defaults', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.branch_manager).toContain('approvals.review');
    expect(DEFAULT_ROLE_PERMISSIONS.branch_manager).toContain('pos.reprint');
  });

  it('removes pos.reprint only when approvals.review is not enabled', () => {
    expect(migration).toContain("- 'pos.reprint'");
    expect(migration).toContain("permissions ->> 'pos.reprint'");
    expect(migration).toContain("permissions ->> 'approvals.review'");
    expect(migration).not.toContain("- 'pos.receipt.print'");
    expect(migration).not.toContain('cloud_print_jobs');
    expect(migration).not.toContain('printer_stations');
    expect(migration).not.toContain('print-agent-lite');
  });
});
