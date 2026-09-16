import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const orderHook = readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');

describe('POS sent-only settlement contract', () => {
  it.todo('derives payable and printable cart quantities from authoritative kitchen sends');
  it.todo('excludes unsent additions from open-order receipt and checkout totals');
  it.todo('includes a later kitchen delta exactly once after successful send');

  it('documents current implementation points that must be replaced by sent-only projections', () => {
    expect(workspace).toContain('const hasUnsentItems = useMemo');
    expect(orderHook).toContain('const printReceipt = useCallback');
    expect(orderHook).toContain('const completeSale = useCallback');
  });
});
