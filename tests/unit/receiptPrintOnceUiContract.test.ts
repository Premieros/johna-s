import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
const wrapper = readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const perms = readFileSync('src/features/pos/hooks/usePosPermissions.ts', 'utf8');

describe('receipt print-once UI guard', () => {
  it('locks completed receipt printing after the first accepted queue for non-reprinters', () => {
    expect(base).toContain('receiptPrintLocked');
    expect(base).toContain('setReceiptPrintLocked(true)');
    expect(wrapper).toContain('base.receiptPrintLocked && !perms.canReprint');
    expect(workspace).toContain('disabled={pos.receiptPrintLocked && !perms.canReprint}');
    expect(workspace).toContain("isAr ? 'تمت الطباعة' : 'Printed'");
  });

  it('keeps direct reprint permission-first', () => {
    expect(perms).toContain("canReprint: can('pos.reprint')");
    expect(workspace).not.toContain('branch_manager');
    expect(wrapper).not.toContain('branch_manager');
  });
});
