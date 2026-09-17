import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/features/pos/hooks/usePosOrder.ts'),
  'utf8',
);

describe('payment receipt isolation contract', () => {
  it('clears stale settlement receipt before delegating a direct sale payment', () => {
    expect(source).toContain(
      "if (!base.activeOrderId) {\n      setSettlementReceipt(null);\n      setSettlementReceiptSaleId(null);\n      return base.completeSale();\n    }",
    );
  });

  it('clears settlement receipt data when the receipt is closed', () => {
    expect(source).toContain(
      "closeReceipt: () => {\n      setSettlementReceipt(null);\n      setSettlementReceiptSaleId(null);\n      base.closeReceipt();\n    },",
    );
  });

  it('keeps the newest receipt selection deterministic', () => {
    expect(source).toContain('lastReceipt: settlementReceipt || base.lastReceipt');
  });
});
