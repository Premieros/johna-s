import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');

describe('sent order payment read-only contract', () => {
  it('does not rewrite sent order lines when opening or completing settlement', () => {
    expect(source).toContain('const preview = await loadSettlementPreview(false);');
    expect(source).toContain('const preview = settlementPreview || await loadSettlementPreview(false);');
    expect(source).not.toContain('const preview = await loadSettlementPreview(true);');
    expect(source).not.toContain('settlementPreview || await loadSettlementPreview(true)');
  });

  it('keeps snapshot persistence available outside the payment path', () => {
    expect(source).toContain('const saveOpenOrderSnapshot = useCallback');
    expect(source).toContain('api.floorPlan.updateOrder');
  });
});
