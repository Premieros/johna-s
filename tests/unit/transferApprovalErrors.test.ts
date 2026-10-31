import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('warehouse transfer approval error presentation', () => {
  const page = readFileSync('src/features/inventory/pages/TransfersPage.tsx', 'utf8');

  it('recognizes safe insufficient-stock errors returned by the existing RPC', () => {
    expect(page).toContain("code === 'INSUFFICIENT_RAW_STOCK'");
    expect(page).toContain("code === 'INSUFFICIENT_STOCK'");
    expect(page).toContain('details?.required');
    expect(page).toContain('details?.available');
    expect(page).toContain('transferApprovalFailureMessage(result)');
  });

  it('retains the existing single approve RPC without modifying inventory', () => {
    expect(page).toContain('api.inventory.approveTransfer({ p_transfer_id: tr.id })');
    expect(page).toContain('void reloadTransfers()');
    expect(page).not.toContain('api.inventory.adjustRawStock(');
  });

  it('does not expose arbitrary database details as an approval failure', () => {
    expect(page).toContain('return uncertainMessage;');
  });
});
