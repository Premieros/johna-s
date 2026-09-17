import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('POS empty-cart visual contract', () => {
  it('keeps the empty cart compact and actionable', () => {
    const panel = source('src/features/pos/components/order/CurrentOrderPanel.tsx');
    expect(panel).toContain('data-testid="pos-empty-cart-state"');
    expect(panel).toContain('data-testid="pos-empty-cart-add-item"');
    expect(panel).toContain('{!empty && (');
    expect(panel).toContain('canDiscount && !empty');
  });

  it('does not surface Print before a printable sent receipt exists', () => {
    const header = source('src/features/pos/components/order/PosOrderHeaderBar.tsx');
    expect(header).toContain('perms.canPrint && canPrintSentReceipt');
    expect(header).not.toContain('disabled={!canPrintSentReceipt}');
  });
});
