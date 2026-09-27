import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const splitItem = readFileSync('src/features/pos/components/tables/TransferItemModal.tsx', 'utf8');
const transferOrder = readFileSync('src/features/pos/components/tables/TransferOrderModal.tsx', 'utf8');
const roles = readFileSync('src/context/RolesContext.tsx', 'utf8');

describe('zero-cost idle polling contract', () => {
  it('watches split approval by request id without a polling timer', () => {
    expect(splitItem).toContain(".channel(`split-item-approval-${pendingRequestId}`)");
    expect(splitItem).toContain("event: 'UPDATE'");
    expect(splitItem).toContain("table: 'approval_requests'");
    expect(splitItem).toContain("filter: `id=eq.${pendingRequestId}`");
    expect(splitItem).toContain("if (status === 'SUBSCRIBED') void readCurrentStatus();");
    expect(splitItem).not.toContain('setInterval(');
    expect(splitItem).not.toContain('clearInterval(');
  });

  it('watches transfer approval by request id without a polling timer', () => {
    expect(transferOrder).toContain(".channel(`transfer-order-approval-${pendingRequestId}`)");
    expect(transferOrder).toContain("event: 'UPDATE'");
    expect(transferOrder).toContain("table: 'approval_requests'");
    expect(transferOrder).toContain("filter: `id=eq.${pendingRequestId}`");
    expect(transferOrder).toContain("if (status === 'SUBSCRIBED') void readCurrentStatus();");
    expect(transferOrder).not.toContain('setInterval(');
    expect(transferOrder).not.toContain('clearInterval(');
  });

  it('uses event-only approval recovery instead of background polling', () => {
    for (const source of [splitItem, transferOrder]) {
      expect(source).toContain("window.addEventListener('online', refreshAfterReconnect)");
      expect(source).toContain("document.addEventListener('visibilitychange', refreshWhenVisible)");
      expect(source).toContain('void supabase.removeChannel(channel)');
    }
  });

  it('keeps role polling bounded to visible sessions while preserving explicit mutation refreshes', () => {
    expect(roles).toContain('const ROLE_REFRESH_INTERVAL_MS = 5 * 60_000;');
    expect(roles).toContain("if (document.visibilityState === 'visible') refreshNow();");
    expect(roles).toContain("window.addEventListener('focus', refreshIfStale)");
    expect(roles).toContain('await refresh();');
  });

  it('does not pull frozen printing or kitchen transport into this optimization', () => {
    for (const source of [splitItem, transferOrder, roles]) {
      expect(source).not.toContain('cloud_print_jobs');
      expect(source).not.toContain('order_kitchen_sends');
      expect(source).not.toContain('claim_cloud_print_jobs');
      expect(source).not.toContain('send_to_kitchen');
    }
  });
});
