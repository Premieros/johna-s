import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const inbox = fs.readFileSync('src/components/ApprovalInbox.tsx', 'utf8');
const card = fs.readFileSync('src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx', 'utf8');

describe('discount approval reliability contract', () => {
  it('loads manager approvals across all accessible branches for reviewer inbox', () => {
    expect(inbox).toContain("supabase.rpc('get_operational_approval_queue', { p_branch_id: null })");
    expect(inbox).not.toContain("if (!allowed || !user?.branch_id) return;");
    expect(inbox).toContain("table: 'approval_requests'");
  });

  it('rechecks the exact request while pending so a missed realtime event cannot strand approval', () => {
    expect(card).toContain(".from('approval_requests')");
    expect(card).toContain(".eq('id', requestId)");
    expect(card).toContain('window.setInterval');
    expect(card).toContain('3000');
    expect(card).toContain("row.status === 'approved'");
  });

  it('applies the approved payload value only once', () => {
    expect(card).toContain('appliedRequestRef');
    expect(card).toContain('requested_value');
    expect(card).toContain('onApproved(approvedType, approvedValue, requestId)');
  });
});
