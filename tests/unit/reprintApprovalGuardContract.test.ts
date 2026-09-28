import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from '../../src/lib/permissionDefs';

const migration = readFileSync(
  'supabase/migrations/20260919161500_require_reprint_approval_for_non_approvers.sql',
  'utf8',
);
const operatorFix = readFileSync(
  'supabase/migrations/20260928080500_operator_friction_fixes.sql',
  'utf8',
);
const salesPage = readFileSync('src/features/trade/pages/SalesPage.tsx', 'utf8');

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

  it('honors pos.reprint at cloud completion instead of demanding a manager approval row', () => {
    expect(operatorFix).toContain('v_requester_can_reprint');
    expect(operatorFix).toContain("? 'pos.reprint'");
    expect(operatorFix).toContain('v_print_count > 0 AND NOT v_requester_can_reprint');
    expect(operatorFix).toContain('direct_reprint_permission');
  });

  it('locks one-time invoice print actions after an authoritative print event', () => {
    expect(salesPage).toContain('sale_print_events(id)');
    expect(salesPage).toContain('receiptAlreadyPrinted');
    expect(salesPage).toContain('receiptAlreadyPrinted(r) && !canReprintReceipt');
    expect(salesPage).toContain("can('pos.reprint')");
  });
});
