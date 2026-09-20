import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/pos/pages/ActiveOrdersPage.tsx', 'utf8');

describe('active orders cancellation contract', () => {
  it('requires the cancellation permission before exposing or executing cancellation', () => {
    expect(source).toContain("const canCancelOrder = can('pos.cancel_order')");
    expect(source).toContain("if (status === 'cancelled' && !canCancelOrder) return");
    expect(source).toContain('{canCancelOrder && <Button');
  });

  it('collects and sends the required cancellation reason to set_order_status', () => {
    expect(source).toContain("window.prompt(");
    expect(source).toContain("notes = entered.trim()");
    expect(source).toContain("notes.length < 3");
    expect(source).toContain("p_status: status");
    expect(source).toContain("p_notes: notes");
  });
});
